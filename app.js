
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyWXIkKFqgJqG8r1KFBMzOF3SoM9_ps8Ws9EUF0wKmCgJxZWoIEzDthyOmo0KIbz0-r3g/exec";
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

function loadSentStockAlerts(){
  try{
    const raw = localStorage.getItem('sentStockAlerts');
    if(raw){
      const arr = JSON.parse(raw);
      sentStockAlerts = new Set(arr);
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

// Inicializar la cámara usando la misma lógica que en la app de visitas
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
        (errorMessage) => { /* ignorar errores continuos de búsqueda */ }
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
      document.getElementById('scanned-result').innerHTML = 'Código: <b>Detenido</b>';
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
  const total = cantidad;
  document.getElementById("codigo").value = decodedText;
  document.getElementById("scanned-result").innerHTML = `Código: <b>${decodedText}</b> — Cantidad: <b>${total}</b>`;
  if (navigator.vibrate) navigator.vibrate(120);
}

// Obtener datos desde la Google Sheet
function cargarStock() {
  fetch(`${SCRIPT_URL}?action=obtenerInsumos`)
    .then(async res => {
      const text = await res.text().catch(() => '');
      try { return JSON.parse(text); } catch (e) { return { exito: false, data: [], error: text || 'Respuesta no JSON' }; }
    })
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

function registrar() {
  const payload = {
    tipo: document.getElementById("tipo").value,
    codigo: document.getElementById("codigo").value,
    descripcion: document.getElementById("descripcion") ? document.getElementById("descripcion").value : undefined,
    cantidad: document.getElementById("cantidad").value,
    maestranza: document.getElementById("maestranza").value,
    guardia: document.getElementById("guardia").value
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

  payload.cantidad = Number(payload.cantidad) || 1;

  const registroPayload = {
    action: 'registrarMovimiento',
    ...payload
  };

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registroPayload)
  })
    .then(async res => {
      const text = await res.text().catch(() => '');
      try { return JSON.parse(text); } catch (e) { return { exito: false, error: text || 'Respuesta no JSON' }; }
    })
    .then(res => {
      if(res.exito) {
        const movimiento = {
          tipo: payload.tipo,
          codigo: payload.codigo,
          descripcion: payload.descripcion,
          cantidad: payload.cantidad,
          maestranza: payload.maestranza,
          guardia: payload.guardia,
          fecha: new Date().toISOString()
        };
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
        document.getElementById("descripcion").value = "";
        setTimeout(() => cargarStock(), 250);
        renderizarInsumos(todosLosInsumos);
      } else {
        alert("Error: " + res.error);
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

function generarReporteGerencial(){
  activarEnvioCorreo('Reporte de Stock Total solicitado desde la App', getContactEmail())
    .then(()=> console.log('generarReporteGerencial: activación creada'))
    .catch(err => {
      console.error('Error generarReporteGerencial:', err);
      alert('Error al activar el reporte. Revisa la consola.');
    });
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
  const registroPayload = { action: 'registrarMovimiento', ...payload };

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registroPayload)
  })
    .then(async res => {
      const text = await res.text().catch(() => '');
      try { return JSON.parse(text); } catch (e) { return { exito: false, error: text || 'Respuesta no JSON' }; }
    })
    .then(res => {
      if(res.exito){
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
      } else alert('Error: ' + res.error);
    }).catch(() => alert('Error comunicando con el servidor'));
}

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
  if (display) display.textContent = `Cierre: ${cierreHora.toLocaleTimeString('es-AR', { hour12: false })}`;

  mostrarNotificacion('Cierre registrado a las ' + cierreHora.toLocaleTimeString('es-AR', { hour12: false }));

  activarEnvioCorreo('Cierre de almacén - reporte de jornada: ' + JSON.stringify(resumen), getContactEmail())
    .then(() => mostrarNotificacion('Solicitud de cierre registrada en ACTIVACION DE CORREO'))
    .catch(err => {
      console.error('Error envio cierre:', err);
      mostrarNotificacion('Error registrando solicitud de cierre');
    });

  sessionMovements = [];
}

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

function callScriptAction(action, params = {}, options = {}){
  const method = (options.method || 'GET').toUpperCase();
  let url = SCRIPT_URL;
  if(method === 'GET'){
    const qs = Object.keys({ action, ...params }).map(k => `${encodeURIComponent(k)}=${encodeURIComponent((k==='action'? action: params[k]))}`).join('&');
    url = `${SCRIPT_URL}?${qs}`;
  }

  const fetchOpts = (method === 'GET') ? {} : {
    method: 'POST',
    body: JSON.stringify({ action, ...params })
  };

  if(fetchOpts.method === 'POST'){
    fetchOpts.headers = Object.assign({ 'Content-Type': 'application/json' }, fetchOpts.headers || {});
  }

  return fetch(url, fetchOpts)
    .then(async res => {
      const text = await res.text().catch(() => '');
      if(!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText + ' - ' + text);
      try{ return JSON.parse(text); }catch(e){ return { raw: text }; }
    })
    .catch(err => {
      console.warn('callScriptAction fetch failed, intentando fallback form POST:', err);
      return new Promise((resolve) => {
        try {
          const iframeName = 'hidden_iframe_' + Math.random().toString(36).slice(2);
          const iframe = document.createElement('iframe');
          iframe.name = iframeName;
          iframe.style.display = 'none';
          document.body.appendChild(iframe);

          const form = document.createElement('form');
          form.method = 'POST';
          form.action = url;
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
