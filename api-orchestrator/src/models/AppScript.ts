import { Schema, model, type Document, type Types } from "mongoose";

export interface IAppScript extends Document {
  app_id: Types.ObjectId;
  filename: string;
  language: "javascript" | "typescript";
  source: string;
  compiled: string;
  description: string;
  updated_at: Date;
  created_at: Date;
}

const AppScriptSchema = new Schema<IAppScript>(
  {
    app_id:      { type: Schema.Types.ObjectId, required: true, ref: "App" },
    filename:    { type: String, required: true, trim: true },
    language:    { type: String, enum: ["javascript", "typescript"], default: "javascript" },
    source:      { type: String, default: "" },
    compiled:    { type: String, default: "" },
    description: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

AppScriptSchema.index({ app_id: 1, filename: 1 }, { unique: true });

export const AppScript = model<IAppScript>("AppScript", AppScriptSchema);
