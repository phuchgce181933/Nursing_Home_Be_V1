/**
 * After express.json / express.text: parse string body to JSON object.
 */
const parseJsonBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return next();
  }

  if (typeof req.body !== 'string') {
    return next();
  }

  const trimmed = req.body.trim();
  if (!trimmed) {
    req.body = {};
    return next();
  }

  try {
    req.body = JSON.parse(trimmed);
  } catch {
    return res.status(400).json({
      message:
        'Invalid JSON body. In Postman: Body → raw → chọn JSON (không phải Text), hoặc thêm header Content-Type: application/json',
    });
  }

  return next();
};

module.exports = parseJsonBody;
