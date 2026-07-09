import mongoose from "mongoose";
import jwt from "jsonwebtoken";

const userSchema = mongoose.Schema({
  username: {
    type: String,
    default: "Unkonwn",
  },
  email: {
    type: String,
    required: true,
    unique: true,
    default: "xyz@gmail.com",
  },
  password: {
    type: String,
    required: true,
    default: "Abc@1234",
  },
  authProvider: {
    type: String,
    enum: ["password", "google"],
    default: "password",
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  subscription: {
    type: String,
    enum: ["Free", "Premium"],
    default: "Free",
  },
  endDateOfSubscription: {
    type: Date,
    default: null,
  },
  Viewer: {
    type: [Number],
    default: null,
  },
  LinkTags: {
    type: [String],
    default: null,
  },
});

export const User = mongoose.model("User", userSchema);
