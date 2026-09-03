import { Schema, model, type Document } from "mongoose";

export interface IOrganization extends Document {
  name: string;
  slug: string;
  created_at: Date;
  updated_at: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Organization = model<IOrganization>("Organization", OrganizationSchema);
