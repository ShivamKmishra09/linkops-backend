import { User } from "../models/User.js";
import { ApiError } from "../utilities/ApiError.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createSystemCollections } from "../services/systemCollectionService.js";

const ALLOWED_EMAIL_DOMAIN = "@meesho.com";

const normalizeEmail = (email = "") => String(email).trim().toLowerCase();

const assertMeeshoEmail = (email) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new ApiError(400, "Email is required");
  }

  if (!normalizedEmail.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    throw new ApiError(
      403,
      "LinkOps is currently available only for @meesho.com work emails."
    );
  }

  return normalizedEmail;
};

const signAuthToken = (user) =>
  jwt.sign(
    {
      email: user.email,
      userId: user._id,
      emailVerified: Boolean(user.emailVerified),
    },
    process.env.JWT_KEY
  );

export const registerUser = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || username.trim() === "") throw new ApiError(400, "Name is required");
  if (!password || password.trim() === "")
    throw new ApiError(400, "Password is required");

  const normalizedEmail = assertMeeshoEmail(email);
  const existedUser = await User.findOne({ email: normalizedEmail });

  if (existedUser) {
    throw new ApiError(409, "An account already exists for this email.");
  }

  const hash = await bcrypt.hash(password, 10);
  const user = new User({
    username: username.trim(),
    email: normalizedEmail,
    password: hash,
    subscription: "Free",
    authProvider: "password",
    emailVerified: false,
  });

  const result = await user.save();

  try {
    await createSystemCollections(result._id);
    console.log(`System collections created for user ${result._id}`);
  } catch (error) {
    console.error("Error creating system collections:", error);
  }

  res.status(201).json({
    message: "user created",
    emailVerificationRequired: true,
  });
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!password || password.trim() === "") {
    throw new ApiError(400, "Password is required");
  }

  const normalizedEmail = assertMeeshoEmail(email);
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credentials");
  }

  const token = signAuthToken(user);
  res.cookie('jwtToken', token, {
    sameSite: 'None', httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 3600*1000*2
  });

  return res.status(200).send({
    message: 'Auth successful',
    token: token,
    user,
  });
});

export const googleAuthHandler = asyncHandler(async (req, res) => {
  const { email, username, emailVerified } = req.body;
  const normalizedEmail = assertMeeshoEmail(email);

  if (emailVerified !== true) {
    throw new ApiError(
      403,
      "Google did not return a verified work email. Please use a verified @meesho.com account."
    );
  }

  try {
    // Check if user exists with this email
    let user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      // Create new user if it doesn't exist
      const hash = await bcrypt.hash(process.env.GOOGLE_AUTH_PASSWORD, 10);
      
      user = new User({
        username: username || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        password: hash,
        subscription: "Free",
        authProvider: "google",
        emailVerified: true,
        Links: {
          oldLink: [],
          newLink: []
        },
        Viewer: []
      });
      
      await user.save();
      
      // Create system collections for the new user
      try {
        await createSystemCollections(user._id);
        console.log(`System collections created for user ${user._id}`);
      } catch (error) {
        console.error("Error creating system collections:", error);
        // Don't fail the registration if system collections fail
      }
    } else {
      // Make sure existing user has Links properly initialized
      if (!user.Links) {
        user.Links = { oldLink: [], newLink: [] };
        await user.save();
      } else if (!user.Links.oldLink || !user.Links.newLink) {
        if (!user.Links.oldLink) user.Links.oldLink = [];
        if (!user.Links.newLink) user.Links.newLink = [];
        await user.save();
      }

      if (!user.emailVerified || user.authProvider !== "google") {
        user.emailVerified = true;
        user.authProvider = "google";
        await user.save();
      }
    }
    
    // Generate token and send response
    const token = signAuthToken(user);
    
    res.cookie('jwtToken', token, {
      sameSite: 'None', 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      maxAge: 3600*1000*2
    });
    
    return res.status(200).send({
      message: 'Auth successful',
      token: token,
      user,
    });
  } catch (error) {
    console.error("Error in Google authentication:", error);
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Authentication failed");
  }
});

export const authenticateUser = asyncHandler(async (req, res) => {
  try {
    const bearerHeader = req.headers.authorization;
    const token = bearerHeader.split(' ')[1]
    const decodedToken = jwt.verify(token, process.env.JWT_KEY);
    const user = await User.findById(decodedToken.userId).populate('subscription')
    
    // Ensure Links is properly initialized
    if (!user.Links) {
      user.Links = { oldLink: [], newLink: [] };
      await user.save();
    } else if (!user.Links.oldLink || !user.Links.newLink) {
      if (!user.Links.oldLink) user.Links.oldLink = [];
      if (!user.Links.newLink) user.Links.newLink = [];
      await user.save();
    }
    
    res.status(200).json({
      "user": user,
    });
  }
  catch(error) {
    console.error("Authentication error:", error);
    res.status(401).send({
      message: "Authentication failed"
    });
  }
});

export const logoutUser = asyncHandler(async (req, res) => {
  res.clearCookie('jwtToken');
  res.redirect(200, process.env.REACT_APP_FRONTEND_URL);
});
