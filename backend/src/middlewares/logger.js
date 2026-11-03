// Middleware de Express: registra método, ruta, código y tiempo de respuesta
module.exports = function logger(req, res, next) {
  const inicio = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - inicio} ms)`);
    }
  });
  next();
};
