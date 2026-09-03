import { Schema, model, type Document, type Types } from "mongoose";

export type UserRole = "admin" | "sub_admin" | "viewer";

export interface IUser extends Document {
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  org_id: Types.ObjectId | null;
  created_by: Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username:               { type: String, required: true, unique: true, trim: true, lowercase: true },
    email:                  { type: String, required: true, unique: true, trim: true, lowercase: true },
    password_hash:          { type: String, required: true },
    role:                   { type: String, enum: ["admin", "sub_admin", "viewer"], default: "viewer" },
    is_active:              { type: Boolean, default: true },
    must_change_password:   { type: Boolean, default: false },
    failed_login_attempts:  { type: Number, default: 0 },
    locked_until:           { type: Date, default: null },
    last_login_at:          { type: Date, default: null },
    org_id:                 { type: Schema.Types.ObjectId, default: null, ref: "Organization" },
    created_by:             { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);



export const User = model<IUser>("User", UserSchema);
