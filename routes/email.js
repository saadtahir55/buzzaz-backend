const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

const createTransporter = () => {
  const service = process.env.EMAIL_SERVICE || 'gmail';
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  return nodemailer.createTransport({
    service,
    auth: { user, pass }
  });
};

// Send collaboration email
router.post('/collaboration', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      message,
      influencerName,
      influencerEmail,
      influencerInstagram,
      instagramProfileUrl
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !message) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const transporter = createTransporter();

    // Email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'muhammad.shahzaib@grobyte.io',
      subject: `New Collaboration Request for ${influencerName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6f42c1;">New Collaboration Request</h2>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #495057; margin-top: 0;">Contact Information</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
          </div>

          <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1976d2; margin-top: 0;">Influencer Details</h3>
            <p><strong>Influencer Name:</strong> ${influencerName}</p>
            <p><strong>Instagram Username:</strong> @${influencerInstagram}</p>
            <p><strong>Instagram Profile:</strong> <a href="${instagramProfileUrl}" target="_blank">${instagramProfileUrl}</a></p>
          </div>

          <div style="background-color: #fff3e0; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #f57c00; margin-top: 0;">Collaboration Message</h3>
            <p style="white-space: pre-wrap;">${message}</p>
          </div>

          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d; font-size: 14px;">
              This email was sent from the Buzzaz collaboration platform.
            </p>
          </div>
        </div>
      `
    };

    // Send email
    await transporter.sendMail(mailOptions);

    res.json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
});

router.get('/health', async (req, res) => {
  try {
    const configured = !!process.env.EMAIL_USER && !!process.env.EMAIL_PASS;
    if (!configured) {
      return res.status(400).json({ configured: false, message: 'Email credentials not configured' });
    }
    const transporter = createTransporter();
    try {
      await transporter.verify();
      return res.json({ configured: true, reachable: true });
    } catch (e) {
      return res.status(500).json({ configured: true, reachable: false, message: 'Transport verify failed' });
    }
  } catch (error) {
    res.status(500).json({ configured: false, message: 'Email health error' });
  }
});

module.exports = router;
