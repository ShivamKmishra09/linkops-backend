import mongoose from "mongoose";

const collectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      validate: {
        validator: function (v) {
          return v && v.trim().length > 0;
        },
        message: "Collection name cannot be empty",
      },
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // Add index for better query performance
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Collection",
      default: null,
      index: true, // Add index for nested collection queries
    },
    links: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Link",
      },
    ],
    description: {
      type: String,
      maxlength: 500,
      default: "",
    },
    color: {
      type: String,
      default: "#144EE3",
      validate: {
        validator: function (v) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: "Color must be a valid hex color code",
      },
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    systemCategory: {
      type: String,
      enum: [
        "GitHub Repos & PRs",
        "Confluence Docs",
        "Google Docs & Sheets",
        "Figma Designs",
        "KRD / PRD Docs",
        "Dashboards & Reports",
        "SOPs & Runbooks",
        "Incidents & RCA",
        "Onboarding Docs",
        "Other Work Links",
      ],
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for link count
collectionSchema.virtual("linkCount").get(function () {
  return this.links ? this.links.length : 0;
});

// Virtual for nested collections
collectionSchema.virtual("children", {
  ref: "Collection",
  localField: "_id",
  foreignField: "parent",
});

// Indexes for better performance
collectionSchema.index({ owner: 1, name: 1 }); // For finding collections by owner and name
collectionSchema.index({ owner: 1, parent: 1 }); // For finding nested collections
collectionSchema.index({ owner: 1, createdAt: -1 }); // For sorting by creation date

// Pre-save middleware to ensure name uniqueness per user
collectionSchema.pre("save", async function (next) {
  if (this.isModified("name")) {
    const existingCollection = await this.constructor.findOne({
      owner: this.owner,
      name: this.name,
      _id: { $ne: this._id },
    });

    if (existingCollection) {
      throw new Error(
        "A collection with this name already exists for this user"
      );
    }
  }
  next();
});

// Static method to get collection tree
collectionSchema.statics.getCollectionTree = async function (userId) {
  const collections = await this.find({ owner: userId })
    .populate("children", "name links color")
    .sort({ name: 1 })
    .lean();

  return collections.filter((collection) => !collection.parent);
};

export const Collection = mongoose.model("Collection", collectionSchema);
