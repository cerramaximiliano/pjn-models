/**
 * Pivote de la lista de selección del buscador público PJN.
 *
 * Cuando el buscador devuelve varios expedientes para un número/año y ninguno es el
 * principal (típico en los fueros penales: solo figuran legajos TO01/…, recursos CA…),
 * el verificador (pjn-workers) no puede elegir. La causa que creó el alta queda como
 * PIVOTE: guarda las filas de la lista y la carpeta pasa a 'pending_selection' para
 * que el usuario elija desde la UI (hub). La causa elegida se crea con
 * {number, year, incidente:<canónico>, accessVia:'busqueda', parentCausaId:<pivote>} y el
 * verificador la abre repitiendo la búsqueda y clickeando la fila cuyo canónico coincide.
 *
 * Inyectado vía schema.add(require('../shared/pivote-lista-fields')) en los 28 fueros.
 * `filas[].incidente` es el sufijo canónico de incidenteSufijo.canonizarSufijo.
 */
module.exports = {
    // Cómo se accede a la causa: 'vinculados' (fila de la pestaña Vinculados del
    // principal), 'busqueda' (fila de la lista de selección del buscador público por
    // número/año) o 'list' (pjn-mis-causas: fila del listado privado sin fuero, listOnly).
    // Sin default: los principales no lo llevan.
    accessVia: { type: String, enum: ["vinculados", "list", "busqueda"] },
    // La causa es un pivote de lista de selección (no se verifica; espera la elección).
    isPivot: { type: Boolean },
    // El usuario ya eligió (o canceló) sobre este pivote.
    resolved: { type: Boolean },
    seleccion: {
        type: {
            capturedAt: { type: Date },
            total: { type: Number },
            filas: [{
                _id: false,
                // Texto crudo de la celda EXPEDIENTE ("CFP 12446/2008/TO01/33/1/1/1").
                expediente: { type: String },
                // Sufijo canónico (canonizarSufijo): "TO01/33/1/1/1", "73/1".
                incidente: { type: String },
                caratula: { type: String },
                dependencia: { type: String },
                situacion: { type: String },
                ultAct: { type: Date }
            }]
        },
        // Sin default: Mongoose no debe persistir un objeto vacío en cada save().
        default: undefined
    }
};
