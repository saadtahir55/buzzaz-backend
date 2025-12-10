const multer = require('multer');

// Configure multer for serverless-friendly uploads (memory storage)
const storage = multer.memoryStorage();

// File filter for images and videos only
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image and video files are allowed!'), false);
  }
};

// Configure multer with size limits (serverless-friendly)
// Use MAX_UPLOAD_MB env var; default to 10MB on Vercel/production, 50MB locally
const defaultMb = (process.env.VERCEL || process.env.NODE_ENV === 'production') ? 10 : 50;
const limitMb = parseInt(process.env.MAX_UPLOAD_MB || String(defaultMb), 10);
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: limitMb * 1024 * 1024,
  }
});

module.exports = upload;
