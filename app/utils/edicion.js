// Edición del producto (candado comercial de la licencia). Se fija en el .env del
// servidor al instalar (EDICION=basica|plus) y el cliente NO puede cambiarla desde
// el panel: esa es la diferencia con 'voz_habilitada' (config en BD, preferencia del
// cliente dentro de Plus). La voz solo suena si EDICION=plus Y voz_habilitada=true.
//
// La única feature gateada por edición es la voz (TTS). Cualquier feature que no sea
// voz va a las dos ediciones sin tocar esto.
//
// Default seguro: si el .env no trae EDICION, se asume 'basica' (sin voz), para no
// regalar la voz por un olvido al instalar.
function edicion() {
    return (process.env.EDICION || 'basica').trim().toLowerCase();
}

// ¿Esta instalación incluye la voz por licencia? (edición Plus)
function edicionPlus() {
    return edicion() === 'plus';
}

module.exports = { edicion, edicionPlus };
