const photoService = require('../services/residentPhotoService');

const addPhotos = async (req, res) => {
  try {
    const photos = await photoService.addPhotos(req.user._id, req.params.id, req.body.uploadedPhotos, req.body.caption);
    res.status(201).json({ success: true, data: photos });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listPhotosForCaregiver = async (req, res) => {
  try {
    const photos = await photoService.listPhotosForCaregiver(req.user._id, req.params.id);
    res.json({ success: true, data: photos });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deletePhoto = async (req, res) => {
  try {
    const result = await photoService.deletePhoto(req.user._id, req.params.id, req.params.photoId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listPhotosForFamily = async (req, res) => {
  try {
    const photos = await photoService.listPhotosForFamily(req.user, req.params.residentId);
    res.json({ success: true, data: photos });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  addPhotos,
  listPhotosForCaregiver,
  deletePhoto,
  listPhotosForFamily,
};
