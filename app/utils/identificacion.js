// Forma canónica del número de identificación.
//
// El lector de cédulas rellena con ceros a la izquierda hasta 10 dígitos
// ("0012345678"), pero Biofile maneja el mismo documento sin ellos ("12345678").
// Como el cruce del sync compara la cédula como texto, sin normalizar nunca hay
// match: el registro de recepción queda huérfano y la extensión crea un ingreso
// duplicado. Por eso se canoniza en TODOS los puntos de escritura.
//
// Solo se tocan documentos NUMÉRICOS: un pasaporte alfanumérico (p. ej. "0A7B")
// se deja intacto, porque ahí el cero a la izquierda sí es significativo.
function normalizarIdentificacion(valor) {
    const limpio = String(valor ?? '').trim();
    if (!/^\d+$/.test(limpio)) return limpio;
    return limpio.replace(/^0+/, '') || '0'; // '000' → '0'; nunca queda vacío
}

module.exports = { normalizarIdentificacion };
