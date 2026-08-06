const Imaging = require('../models/imaging');
const { uploadToCloudinary, uploadRawFileToCloudinary } = require('../middleware/uploadMiddleware');

const listImaging = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.residentId) filter.residentId = q.residentId;
    const data = await Imaging.find(filter).sort({ performedAt: -1 }).limit(200).lean();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getImaging = async (req, res) => {
  try {
    const im = await Imaging.findById(req.params.id).lean();
    if (!im) return res.status(404).json({ message: 'Không tìm thấy kết quả chẩn đoán hình ảnh' });
    return res.json({ success: true, data: im });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createImaging = async (req, res) => {
  try {
    const im = new Imaging(req.body);
    await im.save();
    return res.json({ success: true, data: im });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// upload file endpoint using multer in route then call this helper
const uploadFileAndCreate = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Chưa tải lên file nào' });
    const buffer = req.file.buffer;
    const folder = 'nursing-home/imaging';
    const result = await uploadToCloudinary(buffer, folder, { resource_type: 'auto' });
    const im = new Imaging({
      residentId: req.body.residentId,
      performedById: req.body.performedById,
      performedBy: req.body.performedBy,
      performedAt: req.body.performedAt || new Date(),
      status: req.body.status || 'PENDING',
      imagingType: req.body.imagingType,
      report: req.body.report,
      findings: req.body.findings,
      impression: req.body.impression,
      cloudinaryUrl: result.secure_url,
      cloudinaryPublicId: result.public_id,
      uploadedAt: new Date(),
      fileType: req.file.mimetype,
    });
    await im.save();
    return res.json({ success: true, data: im });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateImaging = async (req, res) => {
  try {
    const im = await Imaging.findById(req.params.id);
    if (!im) return res.status(404).json({ message: 'Không tìm thấy kết quả chẩn đoán hình ảnh' });
    Object.assign(im, req.body);
    await im.save();
    return res.json({ success: true, data: im });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const finalizeImaging = async (req, res) => {
  try {
    const im = await Imaging.findById(req.params.id);
    if (!im) return res.status(404).json({ message: 'Không tìm thấy kết quả chẩn đoán hình ảnh' });
    im.status = 'FINALIZED';
    await im.save();
    return res.json({ success: true, data: im });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { listImaging, getImaging, createImaging, uploadFileAndCreate, updateImaging, finalizeImaging };
