const express = require('express');
const router = express.Router();
const controller = require('../controllers/pronunciationController');

router.post('/score', async (req, res, next) => {
  try {
    const result = await controller.processRequest(req.body, req.headers);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
