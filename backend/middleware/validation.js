const validateEmailFormat = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateOTPFormat = (otp) => {
  return /^\d{6}$/.test(otp);
};

const validateUserId = (userId) => {
  return userId && userId.trim().length > 0;
};

const validateSendEmailOTP = (req, res, next) => {
  const { email, userId } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required',
    });
  }

  if (!validateEmailFormat(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format',
    });
  }

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'User ID is required',
    });
  }

  if (!validateUserId(userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format',
    });
  }

  next();
};

const validateVerifyOTP = (req, res, next) => {
  const { otp, userId, deliveryMethod } = req.body;

  if (!otp) {
    return res.status(400).json({
      success: false,
      message: 'OTP is required',
    });
  }

  if (!validateOTPFormat(otp)) {
    return res.status(400).json({
      success: false,
      message: 'OTP must be exactly 6 digits',
    });
  }

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'User ID is required',
    });
  }

  if (!validateUserId(userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format',
    });
  }

  if (deliveryMethod !== 'email') {
    return res.status(400).json({
      success: false,
      message: 'Only email delivery method is supported',
    });
  }

  next();
};

const validateResendOTP = (req, res, next) => {
  const { email, userId } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required',
    });
  }

  if (!validateEmailFormat(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format',
    });
  }

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'User ID is required',
    });
  }

  if (!validateUserId(userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format',
    });
  }

  next();
};

module.exports = {
  validateEmailFormat,
  validateOTPFormat,
  validateUserId,
  validateSendEmailOTP,
  validateVerifyOTP,
  validateResendOTP,
};
