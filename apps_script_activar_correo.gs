/**
 * Handler para Apps Script: escribe una fila en la pestaña "ACTIVACION DE CORREO"
 * y devuelve JSON para que la app confirme la activación.
 * Pega este archivo en tu proyecto de Google Apps Script y despliega como Web App.
 */

function doPost(e){
  try{
    var payload = {};
    if(e && e.postData && e.postData.contents){
      payload = JSON.parse(e.postData.contents);
    } else {
      // Soporte para form-data / querystring (fallback)
      payload = e.parameter || {};
    }

    var action = payload.action || payload['action'] || '';
    if(action === 'activarCorreo'){
      return activarCorreoHandler(payload);
    }

    // Rutas adicionales pueden agregarse aquí
    return jsonResponse({ exito: false, error: 'Accion no reconocida: ' + action });
  }catch(err){
    return jsonResponse({ exito:false, error: String(err) });
  }
}

/**
 * Escribe una nueva fila en la hoja "ACTIVACION DE CORREO".
 * Columnas esperadas (puedes ajustar el orden):
 * A: Fecha y Hora (ISO) | B: Estado | C: Motivo | D: Email | E: Solicitante (opcional)
 */
function activarCorreoHandler(data){
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if(!ss) return jsonResponse({ exito:false, error: 'No hay Spreadsheet activo' });

    var sheetName = 'ACTIVACION DE CORREO';
    var sheet = ss.getSheetByName(sheetName);
    if(!sheet){
      // Si no existe, crear con encabezado básico
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(['FechaHora','Estado','Motivo','Email','Solicitante']);
    }

    var fecha = data.fecha || new Date().toISOString();
    var estado = data.estado || 'PENDIENTE';
    var motivo = data.motivo || data.message || 'Solicitud desde App';
    var email = data.email || data.destino || '';
    var solicitante = data.solicitante || Session.getActiveUser ? Session.getActiveUser().getEmail() : '';

    sheet.appendRow([fecha, estado, motivo, email, solicitante]);

    return jsonResponse({ exito:true, message: 'Activación creada', fila: sheet.getLastRow() });
  }catch(err){
    return jsonResponse({ exito:false, error: String(err) });
  }
}

function jsonResponse(obj){
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
