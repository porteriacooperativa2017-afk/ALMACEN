const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyWXIkKFqgJqG8r1KFBMzOF3SoM9_ps8Ws9EUF0wKmCgJxZWoIEzDthyOmo0KIbz0-r3g/exec";
// Correo para recibir notificaciones y reportes (puedes cambiarlo aquí)
const CONTACT_EMAIL = "PORTERIACOOPERATIVA2017@GMAIL.COM";
const CONTACT_EMAIL_KEY = 'PORTERIACOOPERATIVA2017@GMAIL.COM';

function getContactEmail(){
  try{
    const el = document.getElementById('contact-email-input');
    if(el && el.value && el.value.trim().length>0) return el.value.trim();
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
  }catch(e){ sentStockAlerts = new Set(); }
}

function saveSentStockAlerts(){
  try{ localStorage.setItem('sentStockAlerts', JSON.stringify(Array.from(sentStockAlerts))); }catch(e){}
}

document.addEventListener("DOMContentLoaded", () => {
  // no iniciar la cámara automáticamente; iniciar al "ABRIR ALMACEN"
  loadSentStockAlerts();
  cargarStock();
  // Estado inicial de botones ABRIR / CERRAR
  const btnAbrir = document.getElementById('btn-abrir');
  const btnCerrar = document.getElementById('btn-cerrar');
  if(btnAbrir) { btnAbrir.disabled = false; btnAbrir.innerText = 'ABRIR ALMACEN'; }
  if(btnCerrar) { btnCerrar.disabled = true; btnCerrar.innerText = 'CERRAR ALMACEN'; }
  // Rellenar input de correo con valor por defecto
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

// Inicializar la cámara del dispositivo móvil
function iniciarEscaner() {
  // Preferir Html5Qrcode si está disponible
  try {
    if (window.Html5Qrcode) {
      html5QrCode = new Html5Qrcode("reader");
      // calcular qrbox responsivo según pantalla
      const maxWidth = Math.min(Math.floor(window.innerWidth * 0.9), 640);
      const maxHeight = Math.min(Math.floor(window.innerHeight * 0.5), 480);
      const boxWidth = Math.max(220, Math.floor(maxWidth * 0.9));
      const boxHeight = Math.max(140, Math.floor(maxHeight * 0.6));
      const config = { fps: 10, qrbox: { width: boxWidth, height: boxHeight } };
      // crear overlay visual para ayudar el encuadre
      try{ const reader = document.getElementById('reader');
        let overlay = document.getElementById('qr-box-overlay');
        if(!overlay){ overlay = document.createElement('div'); overlay.id = 'qr-box-overlay'; overlay.className = 'qr-box'; overlay.innerHTML = '<span class="qr-corner tl"></span><span class="qr-corner tr"></span><span class="qr-corner bl"></span><span class="qr-corner br"></span>'; reader.appendChild(overlay); }
        overlay.style.width = boxWidth + 'px'; overlay.style.height = boxHeight + 'px'; overlay.style.left = '50%'; overlay.style.top = '50%'; overlay.style.transform = 'translate(-50%,-50%)';
      }catch(e){}
      html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => onCodigoLeido(decodedText),
        (errorMessage) => {}
      ).catch(err => {
        console.warn('html5QrCode inicio fallo, intentando fallback:', err);
        html5QrCode = null;
        iniciarEscanerFallback();
      });
      return;
    }
  } catch (e){ console.warn('Error iniciando html5-qrcode', e); }

  // Si no está html5-qrcode, intentar API nativa BarcodeDetector o getUserMedia
  iniciarEscanerFallback();
}

function iniciarEscanerFallback(){
  // Crear video si no existe
  try{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      mostrarNotificacion('Cámara no disponible en este dispositivo');
      return;
    }

    // Crear elemento video en #reader
    const reader = document.getElementById('reader');
    reader.innerHTML = '';
    videoElement = document.createElement('video');
    videoElement.setAttribute('playsinline','');
    videoElement.style.width = '100%';
    reader.appendChild(videoElement);

    const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        cameraStream = stream;
        videoElement.srcObject = stream;
        return videoElement.play();
      })
      .then(()=>{
        // crear overlay visual para ayudar el encuadre en fallback
        try{
          const maxWidth = Math.min(Math.floor(window.innerWidth * 0.9), 640);
          const maxHeight = Math.min(Math.floor(window.innerHeight * 0.5), 480);
          const boxWidth = Math.max(220, Math.floor(maxWidth * 0.9));
          const boxHeight = Math.max(140, Math.floor(maxHeight * 0.6));
          let overlay = document.getElementById('qr-box-overlay');
          if(!overlay){ overlay = document.createElement('div'); overlay.id = 'qr-box-overlay'; overlay.className = 'qr-box'; overlay.innerHTML = '<span class="qr-corner tl"></span><span class="qr-corner tr"></span><span class="qr-corner bl"></span><span class="qr-corner br"></span>'; reader.appendChild(overlay); }
          overlay.style.width = boxWidth + 'px'; overlay.style.height = boxHeight + 'px'; overlay.style.left = '50%'; overlay.style.top = '50%'; overlay.style.transform = 'translate(-50%,-50%)';
        }catch(e){}

        // comprobar BarcodeDetector
        if(window.BarcodeDetector){
          try{ barcodeDetector = new BarcodeDetector({formats: ['ean_13','ean_8','code_128','qr_code']}); }catch(e){ barcodeDetector = null; }
        }
        // iniciar loop de detección
        detectionTimer = setInterval(async ()=>{
          try{
            if(barcodeDetector){
              const results = await barcodeDetector.detect(videoElement);
              if(results && results.length>0){ onCodigoLeido(results[0].rawValue); }
            } else {
              // si no hay BarcodeDetector, intentar leer frames con canvas y fallback ligero
              const canvas = document.createElement('canvas');
              canvas.width = videoElement.videoWidth;
              canvas.height = videoElement.videoHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(videoElement,0,0,canvas.width,canvas.height);
              // Sin biblioteca de decodificación no podemos extraer códigos; indicar al usuario
            }
          }catch(e){ /* ignore detection errors */ }
        }, 500);
      })
      .catch(err => { console.error('No se pudo acceder a la cámara:', err); mostrarNotificacion('Error accediendo a la cámara'); });
  }catch(e){ console.error('iniciarEscanerFallback error', e); mostrarNotificacion('Error iniciando escáner'); }
}

function startCamera(){ if(!html5QrCode && !cameraStream) iniciarEscaner(); }
function stopCamera(){ 
  if(html5QrCode){ html5QrCode.stop().then(()=>{ try{ html5QrCode.clear(); }catch(e){} html5QrCode = null; document.getElementById('scanned-result').innerHTML = 'Código: <b>Detenido</b>'; }).catch(()=>{}); }
  if(detectionTimer){ clearInterval(detectionTimer); detectionTimer = null; }
  if(cameraStream){
    try{ cameraStream.getTracks().forEach(t=>t.stop()); }catch(e){}
    cameraStream = null;
  }
  if(videoElement){ try{ videoElement.pause(); videoElement.srcObject = null; videoElement.remove(); }catch(e){} videoElement = null; }
  document.getElementById('scanned-result').innerHTML = 'Código: <b>Detenido</b>';
}

function onCodigoLeido(decodedText){
  // Cada escaneo multiplica por la cantidad indicada
  const cantidad = Number(document.getElementById('cantidad').value) || 1;
  const total = cantidad;
  document.getElementById("codigo").value = decodedText;
  document.getElementById("scanned-result").innerHTML = `Código: <b>${decodedText}</b> — Cantidad: <b>${total}</b>`;
  if (navigator.vibrate) navigator.vibrate(120);
}

// Obtener datos desde la Google Sheet
function cargarStock() {
  fetch(`${SCRIPT_URL}?action=obtenerInsumos`)
    .then(res => res.json())
    .then(data => {
      todosLosInsumos = data;
      renderizarInsumos(todosLosInsumos);
      checkStockAlerts();
    });
}

function checkStockAlerts(){
  todosLosInsumos.forEach(i=>{
    if(i.stock <=5 && i.stock > 0 && !sentStockAlerts.has(i.id)){
      // Enviar solo una vez por ítem: persistir y registrar activación
      sentStockAlerts.add(i.id);
      saveSentStockAlerts();
      activarEnvioCorreo(`Alerta stock: ${i.nombre} (ID ${i.id}) - stock ${i.stock}`, getContactEmail()).catch(()=>{});
      mostrarNotificacion(`Alerta: ${i.nombre} bajo stock (${i.stock})`);
    }
  });
}

function renderizarInsumos(lista) {
  const contenedor = document.getElementById("lista-insumos");
  contenedor.innerHTML = "";

  lista.forEach(i => {
    let badgeClass = "badge-ok";
    // Colores según umbrales
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
  const encontrado = todosLosInsumos.find(x=> x.id == id);
  if(encontrado){
    document.getElementById('codigo').value = encontrado.id;
    document.getElementById('cantidad').value = 1;
    document.getElementById('scanned-result').innerHTML = `Código: <b>${encontrado.id}</b>`;
  }
}

function toggleStockView(){
  const el = document.getElementById('stock-section');
  if(!el) return;
  el.style.display = (el.style.display==='none' || el.style.display==='')? 'block':'none';
}

function filtrarInsumos() {
  const texto = document.getElementById("filtro").value.toLowerCase();
  const filtrados = todosLosInsumos.filter(i => 
    i.nombre.toLowerCase().includes(texto) || 
    i.id.toString().toLowerCase().includes(texto)
  );
  renderizarInsumos(filtrados);
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

  if(!payload.codigo){ alert('Por favor ingresa el código.'); return; }
  // Permitir ingreso de productos que no figuren en stock
  const existe = todosLosInsumos.find(x=> x.id == payload.codigo);
  if(!existe && payload.tipo === 'INGRESO'){
    // marcar como nuevo item y exigir descripción
    payload.nuevoItem = true;
    if(!payload.descripcion || payload.descripcion.trim().length===0){ alert('Para un nuevo producto, ingresa la descripción.'); return; }
  }
  // Si es RETIRO, maestranza y guardia son obligatorios
  if(payload.tipo === 'RETIRO' && (!payload.maestranza || !payload.guardia)){
    alert('Para RETIRO completa Maestranza y Guardia.'); return;
  }

  // Ajustar cantidad multiplicadora
  payload.cantidad = Number(payload.cantidad) || 1;

  fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(res => {
    if(res.exito) {
      // Añadir al resumen de la sesión
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

      // Notificar stock restante si viene en la respuesta
      if(res.nuevoStock !== undefined){
        mostrarNotificacion(`Stock restante: ${res.nuevoStock} unidades`);
        if(res.nuevoStock <=5){
          // registrar activación para alerta crítica
          // Enviar alerta crítica solo una vez por ítem
          if(!sentStockAlerts.has(payload.codigo)){
            sentStockAlerts.add(payload.codigo);
            saveSentStockAlerts();
            activarEnvioCorreo(`Alerta stock crítico: ${payload.descripcion || payload.codigo} (ID ${payload.codigo}) - stock ${res.nuevoStock}`, getContactEmail()).catch(()=>{});
          }
        }
      }

      alert("Movimiento registrado con éxito");
      document.getElementById("codigo").value = "";
      cargarStock();
    } else {
      alert("Error: " + res.error);
    }
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
  // En lugar de pedir envío inmediato, solo activamos la fila en la hoja para que Apps Script procese el envío
  activarEnvioCorreo('Reporte de Stock Total solicitado desde la App', getContactEmail())
    .then(()=> console.log('generarReporteGerencial: activación creada'))
    .catch(err => { console.error('Error generarReporteGerencial:', err); alert('Error al activar el reporte. Revisa la consola.'); });
}

// Registro rápido desde la barra lateral (solo INGRESO)
function registrarRapidoIngreso(){
  const codigo = document.getElementById('ing-codigo').value;
  const descripcion = document.getElementById('ing-desc').value;
  const cantidad = Number(document.getElementById('ing-cant').value) || 1;
  if(!codigo){ alert('Ingrese código'); return; }

  const payload = { tipo: 'INGRESO', codigo, descripcion, cantidad, maestranza: '', guardia: '' };
  fetch(SCRIPT_URL, { method:'POST', body: JSON.stringify(payload) })
    .then(res=>res.json())
    .then(res=>{
      if(res.exito){
        mostrarNotificacion('Ingreso rápido registrado');
        sessionMovements.push({ ...payload, fecha: new Date().toISOString() });
        cargarStock();
        document.getElementById('ing-codigo').value = '';
        document.getElementById('ing-desc').value = '';
      } else alert('Error: '+res.error);
    }).catch(()=> alert('Error comunicando con el servidor'));
}

function abrirAlmacen(){
  if(almacenAbierto) return;
  const maestranza = document.getElementById('apertura-maestranza').value || '';
  const guardia = document.getElementById('apertura-guardia').value || '';
  aperturaHora = new Date();
  almacenAbierto = true;
  sessionMovements = [];
  document.getElementById('btn-abrir').disabled = true;
  document.getElementById('btn-cerrar').disabled = false;
  startTimer();
  mostrarNotificacion('Almacén abierto');
  // Registrar apertura en ACTIVACION DE CORREO para que el Apps Script lo procese
  activarEnvioCorreo('Apertura de almacén - inicio: ' + aperturaHora.toISOString() + ' - Maestranza: ' + maestranza + ' - Guardia: ' + guardia, getContactEmail()).catch(()=>{});
  // Abrir cámara y mostrar vista de stock automáticamente
  try{ startCamera(); }catch(e){}
  const stockEl = document.getElementById('stock-section'); if(stockEl) stockEl.style.display = 'block';
}

function cerrarAlmacen(){
  if(!almacenAbierto) return;
  cierreHora = new Date();
  almacenAbierto = false;
  document.getElementById('btn-abrir').disabled = false;
  document.getElementById('btn-cerrar').disabled = true;
  stopTimer();

  const maestranza = document.getElementById('apertura-maestranza').value || '';
  const guardia = document.getElementById('apertura-guardia').value || '';
  // Preparar síntesis
  const ingresados = sessionMovements.filter(m=> m.tipo === 'INGRESO');
  const retirados = sessionMovements.filter(m=> m.tipo === 'RETIRO');

  const resumen = {
    inicio: aperturaHora ? aperturaHora.toISOString() : null,
    cierre: cierreHora.toISOString(),
    maestranza,
    guardia,
    ingresados,
    retirados
  };

  // Registrar activación para que Apps Script procese el cierre y envíe el correo
  try{ stopCamera(); }catch(e){}
  activarEnvioCorreo('Cierre de almacén - reporte de jornada: ' + JSON.stringify(resumen), getContactEmail())
    .then(()=> mostrarNotificacion('Solicitud de cierre registrada en ACTIVACION DE CORREO'))
    .catch(err => { console.error('Error envio cierre:', err); mostrarNotificacion('Error registrando solicitud de cierre'); });

  // limpiar movimientos
  sessionMovements = [];
}

function startTimer(){
  const display = document.getElementById('timer-display');
  let start = aperturaHora || new Date();
  display.innerText = formatElapsed(new Date() - start);
  timerInterval = setInterval(()=>{
    display.innerText = formatElapsed(new Date() - start);
  },1000);
}

function stopTimer(){
  clearInterval(timerInterval); timerInterval = null; document.getElementById('timer-display').innerText = 'Cerrado';
}

function formatElapsed(ms){
  const total = Math.floor(ms/1000);
  const h = Math.floor(total/3600); const m = Math.floor((total%3600)/60); const s = total%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function mostrarNotificacion(text){
  // Notificación push en navegador
  if('Notification' in window && Notification.permission === 'granted'){
    new Notification('Registro de Movimiento', { body: text });
  } else if('Notification' in window && Notification.permission !== 'denied'){
    Notification.requestPermission().then(p=>{ if(p==='granted') new Notification('Registro de Movimiento', { body: text }); });
  } else {
    // Fallback visual
    const el = document.createElement('div');
    el.className = 'toast'; el.innerText = text;
    document.body.appendChild(el);
    setTimeout(()=> el.remove(), 3500);
  }
}

// Helper para llamadas al Apps Script Web App con logging detallado
function callScriptAction(action, params = {}, options = {}){
  const method = (options.method || 'GET').toUpperCase();
  let url = SCRIPT_URL;
  if(method === 'GET'){
    const qs = Object.keys({ action, ...params }).map(k => `${encodeURIComponent(k)}=${encodeURIComponent((k==='action'? action: params[k]))}`).join('&');
    url = `${SCRIPT_URL}?${qs}`;
  }
  const fetchOpts = (method === 'GET') ? {} : { method: 'POST', body: JSON.stringify({ action, ...params }) };
  // Asegurar headers para JSON
  if(fetchOpts.method === 'POST'){
    fetchOpts.headers = Object.assign({ 'Content-Type': 'application/json' }, fetchOpts.headers || {});
  }
  console.log('callScriptAction ->', method, url, fetchOpts);
  return fetch(url, fetchOpts)
    .then(async res => {
      const text = await res.text().catch(()=>'');
      console.log('callScriptAction response:', action, res.status, res.statusText, text);
      if(!res.ok) throw new Error('HTTP '+res.status+' '+res.statusText+' - '+text);
      try{ return JSON.parse(text); }catch(e){ return { raw: text }; }
    })
    .catch(err => {
      console.warn('callScriptAction fetch failed, intentando fallback form POST:', err);
      // Fallback: enviar mediante un formulario oculto (POST) para evitar bloqueos CORS
      return new Promise((resolve)=>{
        try{
          const iframeName = 'hidden_iframe_' + Math.random().toString(36).slice(2);
          const iframe = document.createElement('iframe');
          iframe.name = iframeName; iframe.style.display = 'none';
          document.body.appendChild(iframe);

          const form = document.createElement('form');
          form.method = 'POST'; form.action = url; form.target = iframeName; form.style.display = 'none';

          // agregar campos
          const bodyObj = Object.assign({ action }, params);
          Object.keys(bodyObj).forEach(k=>{
            const inp = document.createElement('input'); inp.type='hidden'; inp.name = k; inp.value = (bodyObj[k]===undefined||bodyObj[k]===null)?'':String(bodyObj[k]);
            form.appendChild(inp);
          });

          document.body.appendChild(form);
          form.submit();
          // limpiar después
          setTimeout(()=>{ try{ form.remove(); iframe.remove(); }catch(e){}; resolve({ exito:true, raw:'submitted-via-form' }); }, 1200);
        }catch(e){ console.warn('fallback form failed', e); resolve({ exito:false, error: String(e) }); }
      });
    });
}

function solicitarReporte() {
  activarEnvioCorreo('Reporte de Stock Total solicitado desde la App', getContactEmail())
    .then(()=> { console.log('solicitarReporte: activación creada'); alert('Solicitud registrada; el sistema enviará el correo cuando procese la activación.'); })
    .catch(err => { console.error('Error solicitarReporte:', err); alert('Error al solicitar el reporte. Revisa la consola para detalles.'); });
}

// Enviar reporte específicamente a un email de gerencia (útil para probar entrega)
function enviarReporteAGerencia(){
  const defaultEmail = getContactEmail();
  const email = prompt('Ingrese correo de Gerencia para prueba:', defaultEmail);
  if(!email) return;
  mostrarNotificacion('Enviando reporte a ' + email);
  activarEnvioCorreo('Solicitud de reporte a Gerencia (prueba): ' + email, email)
    .then(()=> { console.log('enviarReporteAGerencia: activación creada'); alert('Solicitud registrada para ' + email + '.'); })
    .catch(err=> { console.error('Error enviarReporteAGerencia:', err); alert('Error enviando la solicitud. Revisa la consola.'); });
}

// Añade una entrada en la pestaña "ACTIVACION DE CORREO" para que el Apps Script la procese
function activarEnvioCorreo(motivo, destinoEmail){
  const email = destinoEmail || getContactEmail();
  // Fecha en formato legible similar a '14/8/2026 9:18:27'
  const fechaLocal = new Date();
  const fechaStr = fechaLocal.toLocaleString('es-AR', { hour12: false });
  const payload = {
    motivo: motivo || 'Solicitud desde App',
    email: email,
    fecha: fechaStr,
    estado: 'PENDIENTE'
  };
  // Llamada al back para que escriba la fila en la pestaña ACTIVACION DE CORREO
  return callScriptAction('activarCorreo', payload, { method: 'POST' })
    .then(resp => {
      try{
        if(resp && resp.exito){
          mostrarNotificacion('Solicitud registrada para envío de correo');
        } else {
          mostrarNotificacion('Solicitud registrada (pendiente de procesamiento)');
        }
      }catch(e){ /* ignore */ }
      return resp || { exito:false };
    })
    .catch(err => {
      // No propagar el error: solo intentamos registrar la activación.
      console.warn('activarEnvioCorreo (no crítico):', err);
      mostrarNotificacion('Solicitud registrada localmente (sin confirmar servidor)');
      return { exito:false, error: String(err) };
    });
}
