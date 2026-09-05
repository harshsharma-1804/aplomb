import { Schema, model, type Document, type Types } from "mongoose";

export interface ICorsOrigin extends Document {
  org_id: Types.ObjectId | null;
  origin: string;
  description: string;
  created_by: Types.ObjectId | null;
  created_at: Date;
}

const CorsOriginSchema = new Schema<ICorsOrigin>(
  {
    org_id:      { type: Schema.Types.ObjectId, default: null, ref: "Organization" },
    origin:      { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    created_by:  { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

CorsOriginSchema.index({ org_id: 1, origin: 1 }, { unique: true });

export const CorsOrigin = model<ICorsOrigin>("CorsOrigin", CorsOriginSchema);
