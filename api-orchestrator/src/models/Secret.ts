import { Schema, model, type Document, type Types } from "mongoose";

export interface ISecret extends Document {
  name: string;
  description: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  org_id: Types.ObjectId | null;
  created_by: Types.ObjectId | null;
  created_at: Date;
  rotated_at: Date | null;
  last_used_at: Date | null;
}

const SecretSchema = new Schema<ISecret>(
  {
    name:         { type: String, required: true, unique: true, trim: true },
    description:  { type: String, default: "" },
    ciphertext:   { type: String, required: true },
    iv:           { type: String, required: true },
    auth_tag:     { type: String, required: true },
    org_id:     { type: Schema.Types.ObjectId, default: null, ref: "Organization" },
    created_by: { type: Schema.Types.ObjectId, default: null },
    rotated_at:   { type: Date, default: null },
    last_used_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

export const Secret = model<ISecret>("Secret", SecretSchema);
