import { Schema, model, type Document, type Types } from "mongoose";

export interface ISession extends Document {
  user_id: Types.ObjectId;
  token_hash: string;
  expires_at: Date;
  ip: string;
  user_agent: string;
  created_at: Date;
  revoked_at: Date | null;
}

const SessionSchema = new Schema<ISession>(
  {
    user_id:    { type: Schema.Types.ObjectId, required: true, ref: "User" },
    token_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    ip:         { type: String, default: "" },
    user_agent: { type: String, default: "" },
    revoked_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

SessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ token_hash: 1 });
SessionSchema.index({ user_id: 1 });

export const Session = model<ISession>("Session", SessionSchema);
