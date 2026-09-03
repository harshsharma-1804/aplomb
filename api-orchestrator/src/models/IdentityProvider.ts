import { Schema, model, type Document, type Types } from "mongoose";

export interface IIdentityProvider extends Document {
  name: string;
  type: "oidc";
  issuer: string;
  jwks_uri: string | null;
  audience: string[];
  algorithms: string[];
  claim_mappings: { subject: string; email: string; roles: string };
  clock_tolerance_sec: number;
  is_active: boolean;
  org_id: Types.ObjectId | null;
  created_by: Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const IdentityProviderSchema = new Schema<IIdentityProvider>(
  {
    name:             { type: String, required: true, trim: true },
    type:             { type: String, enum: ["oidc"], default: "oidc" },
    issuer:           { type: String, required: true, unique: true, trim: true },
    jwks_uri:         { type: String, default: null },
    audience:         { type: [String], default: [] },
    algorithms:       { type: [String], default: ["RS256"] },
    claim_mappings: {
      subject: { type: String, default: "sub" },
      email:   { type: String, default: "email" },
      roles:   { type: String, default: "groups" },
    },
    clock_tolerance_sec: { type: Number, default: 60 },
    is_active:           { type: Boolean, default: true },
    org_id:     { type: Schema.Types.ObjectId, default: null, ref: "Organization" },
    created_by: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);



export const IdentityProvider = model<IIdentityProvider>("IdentityProvider", IdentityProviderSchema);
