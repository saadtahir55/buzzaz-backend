const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { admin, db } = require('../config/firebase');
const upload = require('../middleware/upload');
const { uploadBufferToBlob } = require('../services/blob');

const router = express.Router();

// Create UGC Creator profile
router.post('/profile', 
  authMiddleware, 
  requireRole('ugc_creator'),
  upload.single('sampleContent'),
  async (req, res) => {
  try {
    console.log('UGC Profile creation request received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User ID:', req.user.uid);
    
    const userId = req.user.uid;
    
    // Handle file upload or links
    let sampleContentValue = '';
    if (req.body.sampleContentType === 'upload' && req.file) {
      // Upload buffer to Vercel Blob and store public URL
      const { url } = await uploadBufferToBlob(req.file.buffer, req.file.mimetype, req.file.originalname || 'sampleContent');
      sampleContentValue = url;
    } else if (req.body.sampleContentType === 'link') {
      // Parse the JSON array of links
      try {
        const links = typeof req.body.sampleContent === 'string' 
          ? JSON.parse(req.body.sampleContent) 
          : req.body.sampleContent;
        sampleContentValue = Array.isArray(links) ? links : [links];
      } catch (error) {
        return res.status(400).json({ 
          errors: [{ msg: 'Invalid format for sample content links' }] 
        });
      }
    }
    
    // Validate sample content
    if (!sampleContentValue || (Array.isArray(sampleContentValue) && sampleContentValue.length === 0)) {
      return res.status(400).json({ 
        errors: [{ msg: 'Sample content is required (either file upload or links)' }] 
      });
    }
    
    // Parse array fields that come as JSON strings from FormData
    let parsedNiche, parsedContentStyle, parsedLanguages;
    try {
      parsedNiche = typeof req.body.niche === 'string' ? JSON.parse(req.body.niche) : req.body.niche;
      parsedContentStyle = typeof req.body.contentStyle === 'string' ? JSON.parse(req.body.contentStyle) : req.body.contentStyle;
      parsedLanguages = typeof req.body.languages === 'string' ? JSON.parse(req.body.languages) : req.body.languages;
    } catch (error) {
      return res.status(400).json({ 
        errors: [{ msg: 'Invalid format for niche, content style, or languages' }] 
      });
    }
    
    const {
      fullName,
      email,
      phoneNumber,
      city,
      country,
      dateOfBirth,
      gender,
      maritalStatus,
      children,
      bio,
      location,
      sampleContentType,
      faceOrFaceless
    } = req.body;
    
    console.log('Extracted fields:', {
      fullName,
      email,
      phoneNumber,
      city,
      country,
      dateOfBirth,
      gender,
      maritalStatus,
      children,
      bio,
      location,
      sampleContent: sampleContentValue,
      sampleContentType,
      niche: parsedNiche,
      contentStyle: parsedContentStyle,
      faceOrFaceless,
      languages: parsedLanguages,
      uploadedFile: req.file ? (req.file.originalname || 'uploaded') : null
    });

    // Check if profile already exists
    const existingProfile = await db.collection('ugc_creators').doc(userId).get();
    if (existingProfile.exists) {
      return res.status(400).json({ message: 'UGC Creator profile already exists' });
    }

    // Create UGC Creator profile data
    const ugcData = {
      userId,
      fullName,
      email,
      phoneNumber,
      city,
      country,
      dateOfBirth,
      gender,
      maritalStatus,
      children,
      bio,
      location,
      sampleContent: sampleContentValue,
      sampleContentType,
      niche: parsedNiche,
      contentStyle: parsedContentStyle,
      faceOrFaceless,
      languages: parsedLanguages,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      totalProjects: 0,
      completedProjects: 0,
      activeProjects: 0,
      averageRating: 0,
      totalEarnings: 0
    };

    // Save to database
    await db.collection('ugc_creators').doc(userId).set(ugcData);

    // Update user's role to 'ugc_creator' after successful profile creation
    if (req.user.role === 'content_creator') {
      await db.collection('users').doc(userId).update({
        role: 'ugc_creator',
        userType: 'ugc_creator',
        roleChosenAt: new Date().toISOString()
      });
      console.log('User role updated to ugc_creator');
    }

    res.status(201).json({
      message: 'UGC Creator profile created successfully',
      profile: ugcData
    });

  } catch (error) {
    console.error('UGC Creator profile creation error:', error);
    res.status(500).json({ message: 'Server error during profile creation' });
  }
});

// Get UGC Creator profile
router.get('/profile/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get UGC Creator profile
    const profileDoc = await db.collection('ugc_creators').doc(userId).get();
    
    if (!profileDoc.exists) {
      return res.status(404).json({ message: 'UGC Creator profile not found' });
    }

    const profileData = profileDoc.data();

    // Get latest stats (mock data for now)
    const latestStats = {
      totalProjects: profileData.totalProjects || 0,
      completedProjects: profileData.completedProjects || 0,
      activeProjects: profileData.activeProjects || 0,
      averageRating: profileData.averageRating || 0,
      totalEarnings: profileData.totalEarnings || 0
    };

    res.json({
      profile: profileData,
      latestStats
    });

  } catch (error) {
    console.error('Get UGC Creator profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update UGC Creator profile
router.put('/profile/:userId', authMiddleware, [
  body('fullName').optional().notEmpty().withMessage('Full name cannot be empty'),
  body('bio').optional().notEmpty().withMessage('Bio cannot be empty'),
  body('location').optional().notEmpty().withMessage('Location cannot be empty'),
  body('categories').optional().isArray({ min: 1 }).withMessage('At least one category is required'),
  body('contentTypes').optional().isArray({ min: 1 }).withMessage('At least one content type is required'),
  body('priceRangeMin').optional().isFloat({ min: 0.01 }).withMessage('Minimum price must be greater than 0'),
  body('priceRangeMax').optional().isFloat({ min: 0.01 }).withMessage('Maximum price must be greater than 0')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const requestingUserId = req.user.uid;

    // Check if user is updating their own profile
    if (userId !== requestingUserId) {
      return res.status(403).json({ message: 'Unauthorized to update this profile' });
    }

    const docRef = db.collection('ugc_creators').doc(userId);
    const profileDoc = await docRef.get();

    const updateData = { ...req.body };
    
    // Validate price range if both are provided
    if (updateData.priceRangeMin && updateData.priceRangeMax) {
      if (parseFloat(updateData.priceRangeMax) <= parseFloat(updateData.priceRangeMin)) {
        return res.status(400).json({ 
          message: 'Maximum price must be greater than minimum price' 
        });
      }
      updateData.priceRangeMin = parseFloat(updateData.priceRangeMin);
      updateData.priceRangeMax = parseFloat(updateData.priceRangeMax);
    } else if (updateData.priceRangeMin) {
      updateData.priceRangeMin = parseFloat(updateData.priceRangeMin);
    } else if (updateData.priceRangeMax) {
      updateData.priceRangeMax = parseFloat(updateData.priceRangeMax);
    }

    updateData.updatedAt = new Date().toISOString();

    // Upsert profile: create minimal doc if it doesn't exist yet
    if (!profileDoc.exists) {
      await docRef.set({
        ...updateData,
        createdAt: new Date().toISOString(),
        isActive: true
      }, { merge: true });
      const createdProfileDoc = await docRef.get();
      const createdProfile = createdProfileDoc.data();
      return res.json({
        message: 'Profile created successfully',
        profile: createdProfile
      });
    }

    // Update existing profile
    await docRef.update(updateData);

    // Get updated profile
    const updatedProfileDoc = await docRef.get();
    const updatedProfile = updatedProfileDoc.data();

    res.json({
      message: 'Profile updated successfully',
      profile: updatedProfile
    });

  } catch (error) {
    console.error('Update UGC Creator profile error:', error);
    res.status(500).json({ message: 'Server error during profile update' });
  }
});

// Get UGC Creator stats history (mock endpoint for now)
router.get('/stats/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if profile exists
    const profileDoc = await db.collection('ugc_creators').doc(userId).get();
    if (!profileDoc.exists) {
      return res.status(404).json({ message: 'UGC Creator profile not found' });
    }

    // Mock stats history data
    const statsHistory = [
      { month: 'Jan', projects: 2, earnings: 500 },
      { month: 'Feb', projects: 3, earnings: 750 },
      { month: 'Mar', projects: 4, earnings: 1000 },
      { month: 'Apr', projects: 3, earnings: 800 },
      { month: 'May', projects: 5, earnings: 1200 },
      { month: 'Jun', projects: 4, earnings: 950 }
    ];

    res.json(statsHistory);

  } catch (error) {
    console.error('Get UGC Creator stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all UGC Creators (for brands to browse)
router.get('/browse', authMiddleware, async (req, res) => {
  try {
    const {
      categories,
      contentTypes,
      minPrice,
      maxPrice,
      location,
      page = 1,
      limit = 10
    } = req.query;

    let query = db.collection('ugc_creators').where('isActive', '==', true);

    // Apply filters
    if (categories) {
      const categoryArray = categories.split(',');
      query = query.where('categories', 'array-contains-any', categoryArray);
    }

    if (location) {
      query = query.where('location', '>=', location).where('location', '<=', location + '\uf8ff');
    }

    // Get results
    const snapshot = await query.get();
    let ugcCreators = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Filter by price range
      if (minPrice && data.priceRangeMax < parseFloat(minPrice)) return;
      if (maxPrice && data.priceRangeMin > parseFloat(maxPrice)) return;
      
      // Filter by content types
      if (contentTypes) {
        const contentTypeArray = contentTypes.split(',');
        const hasMatchingContentType = contentTypeArray.some(type => 
          data.contentTypes.includes(type)
        );
        if (!hasMatchingContentType) return;
      }

      ugcCreators.push({
        id: doc.id,
        ...data
      });
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedResults = ugcCreators.slice(startIndex, endIndex);

    res.json({
      ugcCreators: paginatedResults,
      totalCount: ugcCreators.length,
      currentPage: parseInt(page),
      totalPages: Math.ceil(ugcCreators.length / limit)
    });

  } catch (error) {
    console.error('Browse UGC Creators error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
