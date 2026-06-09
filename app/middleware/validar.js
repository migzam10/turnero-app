function validarTerminalId(req, res, next) {
    const terminalId = req.headers['x-terminal-id'];
    if (!terminalId) {
        return res.status(400).json({ error: 'Header x-terminal-id requerido' });
    }
    req.terminalId = terminalId;
    next();
}

function validarExtensionSecret(req, res, next) {
    const secret = req.headers['x-extension-secret'];
    if (!secret || secret !== process.env.EXTENSION_SECRET) {
        return res.status(403).json({ error: 'extension_secret_invalido' });
    }
    next();
}

module.exports = { validarTerminalId, validarExtensionSecret };
