const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz4XbH_w6zilatN93j8iVzSUeUAQ0GzL4n42BgEh0kOFx23MFMIAqCFKpWKW86Ffd3Gog/exec";
const CONTACT_EMAIL = "PORTERIACOOPERATIVA2017@GMAIL.COM";
const CONTACT_EMAIL_KEY = 'PORTERIACOOPERATIVA2017@GMAIL.COM';

function getContactEmail(){
  try{
    const el = document.getElementById('contact-email-input');
    if(el && el.value && el.value.trim().length > 0) return el.value.trim();
  }catch(e){}
  return CONTACT_EMAIL;
}

let todosLosInsumos = [];
let html5QrCode = null;
let cameraStream = null;
let videoElement = null;
let barcodeDetector = null;
let detectionTimer = null;
let sessionMovements = [];
let almacenAbierto = false;
let aperturaHora = null;
let cierreHora = null;
let timerInterval = null;
let sentStockAlerts = new Set();
const PERSONAL_CACHE_KEY = 'almacen_personal_cache';

function requiereServidorWeb(){
  if (location.protocol === 'file:') {
    console.error('ERROR DE CONEXION: la app se abrió desde file://, pero Google Apps Script bloquea fetch por CORS. Sirve la carpeta desde un servidor web local (por ejemplo: http://localhost:8000).');
    alert('La app debe abrirse desde un servidor web local (http://localhost) para conectarse a Google Sheets.');
    return true;
  }
  return false;
}

/* =========================================================
   FUNCIÓN CENTRALIZADA PARA COMUNICACIÓN CON GOOGLE APPS SCRIPT
   ========================================================= */
function callScriptAction(action, params = {}, options = {}){
  const method = (options.method || 'GET').toUpperCase();

  if(method === 'GET'){
    const qs = Object.keys({ action, ...params })
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(k === 'action' ? action : params[k])}`)
      .join('&');
    const url = `${SCRIPT_URL}?${qs}`;

    return fetch(url)
      .then(async res => {
        const text = await res.text().catch(() => '');
        if(!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        try{ return JSON.parse(text); }catch(e){ return { exito: true, raw: text }; }
      });
  }

  // Petición POST utilizando JSON enviado como text/plain para omitir CORS Preflight
  const payload = JSON.stringify({ action, ...params });

  return fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: payload
  })
    .then(async res => {
      const text = await res.text().catch(() => '');
      try { return JSON.parse(text); } catch (e) { return { exito: true, raw: text }; }
    })
    .catch(err => {
      console.warn('POST con fetch falló, intentando envío por formulario oculto (fallback):', err);
      return new Promise((resolve) => {
        try {
          const iframeName = 'hidden_iframe_' + Math.random().toString(36).slice(2);
          const iframe = document.createElement('iframe');
          iframe.name = iframeName;
          iframe.style.display = 'none';
          document.body.appendChild(iframe);

          const form = document.createElement('form');
          form.method = 'POST';
          form.action = SCRIPT_URL;
          form.target = iframeName;
          form.style.display = 'none';

          const bodyObj = Object.assign({ action }, params);
          Object.keys(bodyObj).forEach(k => {
            const inp = document.createElement('input');
            inp.type = 'hidden';
            inp.name = k;
            inp.value = (bodyObj[k] === undefined || bodyObj[k] === null) ? '' : String(bodyObj[k]);
            form.appendChild(inp);
          });

          document.body.appendChild(form);
          form.submit();

          setTimeout(() => {
            try{ form.remove(); iframe.remove(); }catch(e){}
            resolve({ exito: true, raw: 'submitted-via-form' });
          }, 1200);
        } catch(e) {
          resolve({ exito: false, error: String(e) });
        }
      });
    });
}

/* =========================================================
   GESTIÓN DE PERSONAL Y CACHÉ
   ========================================================= */
function getPersonalCache(){
  try {
    const raw = localStorage.getItem(PERSONAL_CACHE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(Boolean).map(v => String(v).trim()).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

function savePersonalCache(list){
  try {
    const clean = Array.from(new Set((list || []).map(v => String(v).trim()).filter(Boolean))).slice(0, 50);
    localStorage.setItem(PERSONAL_CACHE_KEY, JSON.stringify(clean));
    return clean;
  } catch (e) {
    return [];
  }
}

function registrarPersonalEnCache(nombre){
  if (!nombre) return getPersonalCache();
  const nombreLimpio = String(nombre).trim();
  if (!nombreLimpio) return getPersonalCache();
  const actual = getPersonalCache();
  const next = [nombreLimpio, ...actual.filter(v => v.toLowerCase() !== nombreLimpio.toLowerCase())].slice(0, 50);
  savePersonalCache(next);
  guardarPersonalEnHoja(nombreLimpio);
  return next;
}

function cargarPersonalDesdeHoja(){
  callScriptAction('obtenerPersonal', {}, { method: 'GET' })
    .then(data => {
      if (data && Array.isArray(data.personal)) {
        savePersonalCache(data.personal);
        syncPersonalDatalist();
      }
    })
    .catch(e => console.warn('No se pudo cargar personal desde la hoja:', e));
}

function guardarPersonalEnHoja(nombre){
  if (!nombre || !String(nombre).trim()) return Promise.resolve({ exito: false, error: 'Nombre vacío' });
  return callScriptAction('guardarPersonal', { nombre: String(nombre).trim() }, { method: 'POST' });
}

function syncPersonalDatalist(){
  const datalist = document.getElementById('lista-personal');
  if (!datalist) return;
  const personal = getPersonalCache();
  datalist.innerHTML = personal.map(nombre => `<option value="${nombre}"></option>`).join('');
  renderPersonalChips();
}

function renderPersonalChips(){
  const personal = getPersonalCache();
  const targetIds = ['chips-maestranza', 'chips-guardia'];

  targetIds.forEach(targetId => {
    const container = document.getElementById(targetId);
    if (!container) return;
    container.innerHTML = '';

    if (!personal.length) {
      const empty = document.createElement('small');
      empty.textContent = 'Sin nombres guardados aún';
      empty.style.color = '#6b7280';
      empty.style.fontSize = '11px';
      container.appendChild(empty);
      return;
    }

    personal.forEach(nombre => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'personal-chip';
      btn.textContent = nombre;
      btn.title = 'Seleccionar ' + nombre;
      btn.style.display = 'inline-block';
      btn.style.margin = '4px 6px 0 0';
      btn.style.padding = '6px 10px';
      btn.style.borderRadius = '999px';
      btn.style.border = '1px solid #dfe3ea';
      btn.style.background = '#f5f7fb';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '12px';
      btn.style.color = '#1f2937';
      btn.addEventListener('click', () => {
        const inputId = targetId === 'chips-maestranza' ? 'maestranza' : 'guardia';
        const input = document.getElementById(inputId);
        if (input) {
          input.value = nombre;
          input.focus();
        }
      });
      container.appendChild(btn);
    });
  });
}

function cargarPersonalDesdeCache(){
  syncPersonalDatalist();
  const maestranza = document.getElementById('maestranza');
  const guardia = document.getElementById('guardia');

  if (maestranza) {
    maestranza.addEventListener('change', () => {
      registrarPersonalEnCache(maestranza.value);
      syncPersonalDatalist();
    });
    maestranza.addEventListener('blur', () => {
      registrarPersonalEnCache(maestranza.value);
      syncPersonalDatalist();
    });
  }

  if (guardia) {
    guardia.addEventListener('change', () => {
      registrarPersonalEnCache(guardia.value);
      syncPersonalDatalist();
    });
    guardia.addEventListener('blur', () => {
      registrarPersonalEnCache(guardia.value);
      syncPersonalDatalist();
    });
  }

  renderPersonalChips();
}

function loadSentStockAlerts(){
  try{
    const raw = localStorage.getItem('sentStockAlerts');
    if(raw){
      sentStockAlerts = new Set(JSON.parse(raw));
    }
  }catch(e){
    sentStockAlerts = new Set();
  }
}

function saveSentStockAlerts(){
  try{
    localStorage.setItem('sentStockAlerts', JSON.stringify(Array.from(sentStockAlerts)));
  }catch(e){}
}

document.addEventListener("DOMContentLoaded", () => {
  loadSentStockAlerts();
  cargarPersonalDesdeCache();
  cargarPersonalDesdeHoja();
  cargarStock();

  const welcomeScreen = document.getElementById('welcome-screen');
  const workspaceScreen = document.getElementById('workspace-screen');
  if (welcomeScreen) welcomeScreen.style.display = 'flex';
  if (workspaceScreen) workspaceScreen.style.display = 'none';

  const btnCerrar = document.getElementById('btn-cerrar');
  if(btnCerrar) {
    btnCerrar.disabled = true;
    btnCerrar.innerText = 'CERRAR ALMACEN';
  }

  const ci = document.getElementById('contact-email-input');
  if(ci){
    const saved = localStorage.getItem(CONTACT_EMAIL_KEY);
    ci.value = (saved && saved.trim().length) ? saved : CONTACT_EMAIL;
    ci.addEventListener('change', ()=>{
      const v = ci.value.trim();
      if(v) localStorage.setItem(CONTACT_EMAIL_KEY, v);
      else localStorage.removeItem(CONTACT_EMAIL_KEY);
      mostrarNotificacion('Correo guardado');
    });
  }
});

/* =========================================================
   CÁMARA Y ESCÁNER
   ========================================================= */
function getCameraErrorName(err){
  if (!err) return 'UnknownError';
  if (err.name) return err.name;
  if (err.constructor && err.constructor.name) return err.constructor.name;
  return 'Error';
}

function reportCameraError(err, context){
  const errorName = getCameraErrorName(err);
  const errorMessage = (err && err.message) ? err.message : String(err || 'Error desconocido');
  console.error(`${context}:`, err);
  const statusNode = document.getElementById('scanned-result');
  if (statusNode) {
    statusNode.innerHTML = `Cámara: <b>${errorName}</b><br><small>${errorMessage}</small>`;
  }
  try {
    if (window.alert) {
      alert(`No se pudo abrir la cámara. Error: ${errorName}\nDetalle: ${errorMessage}`);
    }
  } catch (e) {}
  mostrarNotificacion(`No se pudo abrir la cámara (${errorName})`);
  return { name: errorName, message: errorMessage };
}

async function iniciarEscaner() {
  const reader = document.getElementById('reader');
  if (!reader) return;

  try {
    if (window.Html5Qrcode) {
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
      }
      
      if (html5QrCode.isScanning) return;

      const config = { 
        fps: 20, 
        qrbox: { width: 240, height: 240 },
        videoConstraints: {
          facingMode: "environment",
          width: { min: 640, ideal: 1280 },
          height: { min: 480, ideal: 720 }
        }
      };

      try {
        let overlay = document.getElementById('qr-box-overlay');
        if(!overlay){
          overlay = document.createElement('div');
          overlay.id = 'qr-box-overlay';
          overlay.className = 'qr-box';
          overlay.innerHTML = '<span class="qr-corner tl"></span><span class="qr-corner tr"></span><span class="qr-corner bl"></span><span class="qr-corner br"></span>';
          reader.appendChild(overlay);
        }
        overlay.style.width = '240px';
        overlay.style.height = '240px';
        overlay.style.left = '50%';
        overlay.style.top = '50%';
        overlay.style.transform = 'translate(-50%,-50%)';
      } catch (e) {}

      await html5QrCode.start(
        { facingMode: 'environment' }, 
        config, 
        (decodedText) => onCodigoLeido(decodedText), 
        () => {}
      );

      const statusNode = document.getElementById('scanned-result');
      if (statusNode) statusNode.innerHTML = 'Código: <b>Escaneando…</b>';
      return;
    }
  } catch (err){
    console.warn('html5QrCode falló, intentando fallback:', err);
  }
  
  iniciarEscanerFallback();
}

function iniciarEscanerFallback(){
  try {
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      reportCameraError(new Error('getUserMedia no disponible'), 'Cámara no disponible');
      return;
    }
    const reader = document.getElementById('reader');
    if (!reader) return;
    reader.innerHTML = '';

    videoElement = document.createElement('video');
    videoElement.setAttribute('playsinline','');
    videoElement.setAttribute('autoplay','');
    videoElement.muted = true;
    videoElement.style.width = '100%';
    reader.appendChild(videoElement);

    const constraints = { 
      video: { 
        facingMode: 'environment',
        width: { min: 640, ideal: 1280 },
        height: { min: 480, ideal: 720 }
      }, 
      audio: false 
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        cameraStream = stream;
        videoElement.srcObject = stream;
        videoElement.onloadedmetadata = () => videoElement.play().catch(() => {});
        return videoElement.play();
      })
      .then(() => {
        if(window.BarcodeDetector){
          try{
            barcodeDetector = new BarcodeDetector({formats: ['ean_13','ean_8','code_128','qr_code']});
          }catch(e){
            barcodeDetector = null;
          }
        }

        detectionTimer = setInterval(async ()=>{
          try{
            if(barcodeDetector){
              const results = await barcodeDetector.detect(videoElement);
              if(results && results.length > 0){
                onCodigoLeido(results[0].rawValue);
              }
            }
          }catch(e){}
        }, 500);
      })
      .catch(err => {
        reportCameraError(err, 'getUserMedia');
      });
  } catch(e){
    reportCameraError(e, 'iniciarEscanerFallback');
  }
}

function startCamera(){
  if ((html5QrCode && html5QrCode.isScanning) || cameraStream) return;
  iniciarEscaner();
}

function stopCamera(){
  if(html5QrCode && html5QrCode.isScanning){
    html5QrCode.stop().then(()=>{
      try{ html5QrCode.clear(); }catch(e){}
      const statusNode = document.getElementById('scanned-result');
      if(statusNode) statusNode.innerHTML = 'Código: <b>Detenido</b>';
    }).catch(()=>{});
  }
  if(detectionTimer){
    clearInterval(detectionTimer);
    detectionTimer = null;
  }
  if(cameraStream){
    try{ cameraStream.getTracks().forEach(t=>t.stop()); }catch(e){}
    cameraStream = null;
  }
  if(videoElement){
    try{
      videoElement.pause();
      videoElement.srcObject = null;
      videoElement.remove();
    }catch(e){}
    videoElement = null;
  }
  const statusNode = document.getElementById('scanned-result');
  if(statusNode) statusNode.innerHTML = 'Código: <b>Detenido</b>';
}

function onCodigoLeido(decodedText){
  const cantidad = Number(document.getElementById('cantidad').value) || 1;
  document.getElementById("codigo").value = decodedText;
  document.getElementById("scanned-result").innerHTML = `Código: <b>${decodedText}</b> — Cantidad: <b>${cantidad}</b>`;
  if (navigator.vibrate) navigator.vibrate(120);
}

/* =========================================================
   GESTIÓN DE STOCK E INSUMOS
   ========================================================= */
function cargarStock() {
  callScriptAction('obtenerInsumos', {}, { method: 'GET' })
    .then(data => {
      const lista = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
      todosLosInsumos = lista;
      renderizarInsumos(todosLosInsumos);
      checkStockAlerts();
    })
    .catch(err => {
      console.error('Error cargando stock:', err);
      todosLosInsumos = [];
      renderizarInsumos([]);
    });
}

function checkStockAlerts(){
  todosLosInsumos.forEach(i => {
    if(i.stock <= 5 && i.stock > 0 && !sentStockAlerts.has(i.id)){
      sentStockAlerts.add(i.id);
      saveSentStockAlerts();
      activarEnvioCorreo(`Alerta stock: ${i.nombre} (ID ${i.id}) - stock ${i.stock}`, getContactEmail()).catch(()=>{});
      mostrarNotificacion(`Alerta: ${i.nombre} bajo stock (${i.stock})`);
    }
  });
}

function renderizarInsumos(lista) {
  const contenedor = document.getElementById("lista-insumos");
  if(!contenedor) return;
  contenedor.innerHTML = "";
  lista.forEach(i => {
    let badgeClass = "badge-ok";
    if (i.stock === 0) badgeClass = "badge-empty";
    else if (i.stock < 5) badgeClass = "badge-red";
    else if (i.stock < 10) badgeClass = "badge-orange";
    else if (i.stock < 20) badgeClass = "badge-warning";

    contenedor.innerHTML += `
      <div class="item-card" onclick="seleccionarInsumo('${i.id}')">
        <div>
          <strong>${i.nombre}</strong><br>
          <small>${i.id}</small>
        </div>
        <span class="badge ${badgeClass}">${i.stock} un.</span>
      </div>
    `;
  });
}

function seleccionarInsumo(id){
  const encontrado = todosLosInsumos.find(x => x.id == id);
  if(encontrado){
    document.getElementById('codigo').value = encontrado.id;
    document.getElementById('cantidad').value = 1;
    document.getElementById('scanned-result').innerHTML = `Código: <b>${encontrado.id}</b>`;
  }
}

function toggleStockView(){
  const el = document.getElementById('stock-section');
  if(!el) return;
  el.style.display = (el.style.display === 'none' || el.style.display === '') ? 'block' : 'none';
}

function filtrarInsumos() {
  const texto = document.getElementById("filtro").value.toLowerCase();
  const filtrados = todosLosInsumos.filter(i => 
    i.nombre.toLowerCase().includes(texto) || 
    i.id.toString().toLowerCase().includes(texto)
  );
  renderizarInsumos(filtrados);
}

function setValidationMessage(message, isError = true) {
  const el = document.getElementById('validation-message');
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? 'block' : 'none';
  el.style.color = isError ? '#b00020' : '#0a7f52';
  el.style.background = isError ? '#fdecea' : '#e8f7ef';
  el.style.border = isError ? '1px solid #f5c2c7' : '1px solid #b7e4c7';
}

function clearValidationMessage() {
  setValidationMessage('', true);
}

/* =========================================================
   REGISTRO DE MOVIMIENTOS E INGRESO RÁPIDO
   ========================================================= */
function registrar() {
  if (requiereServidorWeb()) return;

  const maestranzaEl = document.getElementById("maestranza");
  const guardiaEl = document.getElementById("guardia");

  if (maestranzaEl && maestranzaEl.value) registrarPersonalEnCache(maestranzaEl.value);
  if (guardiaEl && guardiaEl.value) registrarPersonalEnCache(guardiaEl.value);
  syncPersonalDatalist();

  const payload = {
    tipo: document.getElementById("tipo").value,
    codigo: document.getElementById("codigo").value,
    descripcion: document.getElementById("descripcion") ? document.getElementById("descripcion").value : undefined,
    cantidad: Number(document.getElementById("cantidad").value) || 1,
    maestranza: maestranzaEl ? maestranzaEl.value : '',
    guardia: guardiaEl ? guardiaEl.value : ''
  };

  if(!payload.codigo){
    setValidationMessage('Por favor ingresa el código.');
    alert('Por favor ingresa el código.');
    return;
  }

  const existe = todosLosInsumos.find(x => x.id == payload.codigo);
  if(!existe && payload.tipo === 'INGRESO'){
    payload.nuevoItem = true;
    if(!payload.descripcion || payload.descripcion.trim().length === 0){
      setValidationMessage('Para un nuevo producto, ingresa la descripción.');
      alert('Para un nuevo producto, ingresa la descripción.');
      return;
    }
  }

  if(!existe && payload.tipo === 'RETIRO'){
    setValidationMessage('No se puede egresar un insumo nuevo. Primero debe registrarse como ingreso.');
    alert('No se puede egresar un insumo nuevo. Primero debe registrarse como ingreso.');
    return;
  }

  if(payload.tipo === 'RETIRO' && (!payload.maestranza || !payload.guardia)){
    setValidationMessage('Para RETIRO completa Maestranza y Guardia.');
    alert('Para RETIRO completa Maestranza y Guardia.');
    return;
  }

  setValidationMessage('Registro válido.', false);
  setTimeout(() => clearValidationMessage(), 1800);

  callScriptAction('registrarMovimiento', payload, { method: 'POST' })
    .then(res => {
      if(res && (res.exito || res.raw === 'submitted-via-form')) {
        const movimiento = { ...payload, fecha: new Date().toISOString() };
        sessionMovements.push(movimiento);

        const itemIndex = todosLosInsumos.findIndex(x => String(x.id) === String(payload.codigo));
        if(itemIndex >= 0) {
          const stockActual = Number(todosLosInsumos[itemIndex].stock) || 0;
          const nuevoStock = (payload.tipo === 'INGRESO') ? stockActual + payload.cantidad : Math.max(0, stockActual - payload.cantidad);
          todosLosInsumos[itemIndex].stock = nuevoStock;
        } else if(payload.tipo === 'INGRESO') {
          todosLosInsumos.push({
            id: payload.codigo,
            nombre: payload.descripcion || 'Nuevo insumo',
            stock: payload.cantidad,
            descripcion: payload.descripcion || ''
          });
        }

        if(res.nuevoStock !== undefined){
          mostrarNotificacion(`Stock restante: ${res.nuevoStock} unidades`);
          if(res.nuevoStock <= 5){
            if(!sentStockAlerts.has(payload.codigo)){
              sentStockAlerts.add(payload.codigo);
              saveSentStockAlerts();
              activarEnvioCorreo(`Alerta stock crítico: ${payload.descripcion || payload.codigo} (ID ${payload.codigo}) - stock ${res.nuevoStock}`, getContactEmail()).catch(()=>{});
            }
          }
        }
        alert("Movimiento registrado con éxito");
        document.getElementById("codigo").value = "";
        if(document.getElementById("descripcion")) document.getElementById("descripcion").value = "";
        setTimeout(() => cargarStock(), 250);
        renderizarInsumos(todosLosInsumos);
      } else {
        alert("Error: " + (res.error || 'Respuesta inválida del servidor'));
      }
    })
    .catch(err => {
      console.error('Error registrando movimiento:', err);
      alert('Error registrando movimiento. Revisa la consola.');
    });
}

function abrirIngresoRapido(){
  document.getElementById('tipo').value = 'INGRESO';
  document.getElementById('cantidad').focus();
}

function abrirSalidaRapido(){
  document.getElementById('tipo').value = 'RETIRO';
  document.getElementById('cantidad').focus();
}

function registrarRapidoIngreso(){
  const codigo = document.getElementById('ing-codigo').value;
  const descripcion = document.getElementById('ing-desc').value;
  const cantidad = Number(document.getElementById('ing-cant').value) || 1;

  if(!codigo){
    alert('Ingrese código');
    return;
  }

  const payload = { tipo: 'INGRESO', codigo, descripcion, cantidad, maestranza: '', guardia: '' };

  callScriptAction('registrarMovimiento', payload, { method: 'POST' })
    .then(res => {
      if(res && (res.exito || res.raw === 'submitted-via-form')){
        mostrarNotificacion('Ingreso rápido registrado');
        sessionMovements.push({ ...payload, fecha: new Date().toISOString() });

        const itemIndex = todosLosInsumos.findIndex(x => String(x.id) === String(codigo));
        if(itemIndex >= 0) {
          todosLosInsumos[itemIndex].stock = Number(todosLosInsumos[itemIndex].stock || 0) + cantidad;
        } else {
          todosLosInsumos.push({ id: codigo, nombre: descripcion || 'Nuevo insumo', stock: cantidad, descripcion: descripcion || '' });
        }

        renderizarInsumos(todosLosInsumos);
        setTimeout(() => cargarStock(), 250);
        document.getElementById('ing-codigo').value = '';
        document.getElementById('ing-desc').value = '';
      } else alert('Error: ' + (res.error || 'Operación no confirmada'));
    })
    .catch(() => alert('Error comunicando con el servidor'));
}

/* =========================================================
   APERTURA Y CIERRE DE JORNADA
   ========================================================= */
function abrirAlmacen(){
  if(almacenAbierto) return;

  const welcomeScreen = document.getElementById('welcome-screen');
  const workspaceScreen = document.getElementById('workspace-screen');
  if (welcomeScreen) welcomeScreen.style.display = 'none';
  if (workspaceScreen) workspaceScreen.style.display = 'block';

  const maestranza = document.getElementById('apertura-maestranza') ? document.getElementById('apertura-maestranza').value : '';
  const guardia = document.getElementById('apertura-guardia') ? document.getElementById('apertura-guardia').value : '';

  aperturaHora = new Date();
  almacenAbierto = true;
  sessionMovements = [];

  const btnCerrar = document.getElementById('btn-cerrar');
  if (btnCerrar) btnCerrar.disabled = false;
  startTimer();
  mostrarNotificacion('Almacén abierto');

  activarEnvioCorreo('Apertura de almacén - inicio: ' + aperturaHora.toISOString() + ' - Maestranza: ' + maestranza + ' - Guardia: ' + guardia, getContactEmail()).catch(()=>{});

  try {
    startCamera();
  } catch(e) {
    reportCameraError(e, 'abrirAlmacen');
  }

  const stockEl = document.getElementById('stock-section');
  if(stockEl) stockEl.style.display = 'block';
}

function cerrarAlmacen(){
  if(!almacenAbierto) return;
  cierreHora = new Date();
  almacenAbierto = false;

  const welcomeScreen = document.getElementById('welcome-screen');
  const workspaceScreen = document.getElementById('workspace-screen');
  if (welcomeScreen) welcomeScreen.style.display = 'flex';
  if (workspaceScreen) workspaceScreen.style.display = 'none';

  const btnCerrar = document.getElementById('btn-cerrar');
  if (btnCerrar) btnCerrar.disabled = true;
  stopTimer();
  stopCamera();

  const maestranza = document.getElementById('maestranza') ? document.getElementById('maestranza').value : '';
  const guardia = document.getElementById('guardia') ? document.getElementById('guardia').value : '';

  const ingresados = sessionMovements.filter(m => m.tipo === 'INGRESO');
  const retirados = sessionMovements.filter(m => m.tipo === 'RETIRO');

  const resumen = {
    inicio: aperturaHora ? aperturaHora.toISOString() : null,
    cierre: cierreHora.toISOString(),
    maestranza,
    guardia,
    ingresados,
    retirados
  };

  const display = document.getElementById('timer-display');
  if (display) display.textContent = 'Cerrado';

  mostrarNotificacion('Cierre registrado a las ' + cierreHora.toLocaleTimeString('es-AR', { hour12: false }));

  callScriptAction('registrarCierre', {
    horaCierre: cierreHora.toISOString(),
    maestranza: maestranza,
    guardia: guardia
  }, { method: 'POST' })
    .then(res => {
      if (!res || (!res.exito && res.raw !== 'submitted-via-form')) {
        console.warn('No se pudo confirmar el cierre en la hoja:', res);
      }
    })
    .catch(err => {
      console.error('Error registrando cierre en la hoja:', err);
    });

  activarEnvioCorreo('Cierre de almacén - reporte de jornada: ' + JSON.stringify(resumen), getContactEmail())
    .then(() => mostrarNotificacion('Solicitud de cierre registrada en ACTIVACION DE CORREO'))
    .catch(err => {
      console.error('Error envio cierre:', err);
      mostrarNotificacion('Error registrando solicitud de cierre');
    });

  sessionMovements = [];
  aperturaHora = null;
}

/* =========================================================
   TEMPORIZADOR Y NOTIFICACIONES
   ========================================================= */
function startTimer(){
  const display = document.getElementById('timer-display');
  if(!display) return;
  let start = aperturaHora || new Date();
  display.innerText = formatElapsed(new Date() - start);
  timerInterval = setInterval(() => {
    display.innerText = formatElapsed(new Date() - start);
  }, 1000);
}

function stopTimer(){
  clearInterval(timerInterval);
  timerInterval = null;
  const display = document.getElementById('timer-display');
  if(display) display.innerText = 'Cerrado';
}

function formatElapsed(ms){
  const total = Math.floor(ms/1000);
  const h = Math.floor(total/3600);
  const m = Math.floor((total%3600)/60);
  const s = total%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function mostrarNotificacion(text){
  if('Notification' in window && Notification.permission === 'granted'){
    new Notification('Registro de Movimiento', { body: text });
  } else if('Notification' in window && Notification.permission !== 'denied'){
    Notification.requestPermission().then(p => {
      if(p === 'granted') new Notification('Registro de Movimiento', { body: text });
    });
  } else {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerText = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}

/* =========================================================
   REPORTES Y ALERTAS POR EMAIL
   ========================================================= */
function generarReporteGerencial(){
  activarEnvioCorreo('Reporte de Stock Total solicitado desde la App', getContactEmail())
    .then(()=> console.log('generarReporteGerencial: activación creada'))
    .catch(err => {
      console.error('Error generarReporteGerencial:', err);
      alert('Error al activar el reporte. Revisa la consola.');
    });
}

function solicitarReporte() {
  activarEnvioCorreo('Reporte de Stock Total solicitado desde la App', getContactEmail())
    .then(() => {
      alert('Solicitud registrada; el sistema enviará el correo cuando procese la activación.');
    })
    .catch(err => {
      console.error('Error solicitarReporte:', err);
      alert('Error al solicitar el reporte. Revisa la consola para detalles.');
    });
}

function enviarReporteAGerencia(){
  const defaultEmail = getContactEmail();
  const email = prompt('Ingrese correo de Gerencia para prueba:', defaultEmail);
  if(!email) return;
  mostrarNotificacion('Enviando reporte a ' + email);
  activarEnvioCorreo('Solicitud de reporte a Gerencia (prueba): ' + email, email)
    .then(() => {
      alert('Solicitud registrada para ' + email + '.');
    })
    .catch(err => {
      console.error('Error enviarReporteAGerencia:', err);
      alert('Error enviando la solicitud. Revisa la consola.');
    });
}

function activarEnvioCorreo(motivo, destinoEmail){
  const email = destinoEmail || getContactEmail();
  const fechaLocal = new Date();
  const fechaStr = fechaLocal.toLocaleString('es-AR', { hour12: false });
  const payload = { motivo: motivo || 'Solicitud desde App', email: email, fecha: fechaStr, estado: 'PENDIENTE' };

  return callScriptAction('activarCorreo', payload, { method: 'POST' })
    .then(resp => {
      try {
        if(resp && resp.exito){
          mostrarNotificacion('Solicitud registrada para envío de correo');
        } else {
          mostrarNotificacion('Solicitud registrada (pendiente de procesamiento)');
        }
      } catch(e){}
      return resp || { exito: false };
    })
    .catch(err => {
      console.warn('activarEnvioCorreo (no crítico):', err);
      mostrarNotificacion('Solicitud registrada localmente (sin confirmar servidor)');
      return { exito: false, error: String(err) };
    });
}

function probarConexionHoja(){
  console.group('Prueba de conexión a Google Sheet');
  console.log('URL de Sheets:', SCRIPT_URL);
  console.log('Cache de personal:', getPersonalCache());

  callScriptAction('verificarConexion', {}, { method: 'GET' })
    .then(data => {
      console.log('Respuesta:', data);
      console.groupEnd();
      if (data && data.exito) {
        alert('Conexión con Google Sheets: OK. La hoja responde correctamente.');
      } else {
        alert('No hay conexión con la hoja de cálculo. Revisa la consola y la URL del Web App.');
      }
    })
    .catch(err => {
      console.error('Error de conexión a Sheet:', err);
      console.groupEnd();
      alert('Error de red o de Web App. Revisa la consola.');
    });
}
