import { Schema, model, type Document, type Types } from "mongoose";

export interface IAppEnvVar {
  key: string;
  value_type: "plain" | "secret";
  plain_value?: string;
  secret_id?: Types.ObjectId | null;
}

export interface IApp extends Document {
  name: string;
  base_path: string;
  description: string;
  status: "draft" | "active" | "deprecated";
  deprecated_at: Date | null;
  allowed_provider_ids: Types.ObjectId[];
  /** When false the runtime skips OIDC validation — for local dev / demo only */
  auth_required: boolean;
  /** Environment this app belongs to — informational label in UI and X-Orchestrator-Mode header */
  mode: "dev" | "qa" | "staging" | "prod";
  /** App-scoped environment variables — plain text or secret references.
   *  Reference in upstream URLs and static header values as {{KEY}} */
  app_env: IAppEnvVar[];
  /** Organization this app belongs to */
  org_id: Types.ObjectId | null;
  created_by: Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const AppSchema = new Schema<IApp>(
  {
    name:                 { type: String, required: true, trim: true },
    base_path:            { type: String, required: true, unique: true, trim: true },
    description:          { type: String, default: "" },
    status:               { type: String, enum: ["draft", "active", "deprecated"], default: "draft" },
    deprecated_at:        { type: Date, default: null },
    allowed_provider_ids: { type: [Schema.Types.ObjectId], default: [] },
    auth_required: { type: Boolean, default: true },
    mode:          { type: String, enum: ["dev", "qa", "staging", "prod"], default: "prod" },
    app_env: {
      type: [{
        key:         { type: String, required: true, trim: true },
        value_type:  { type: String, enum: ["plain", "secret"], default: "plain" },
        plain_value: { type: String },
        secret_id:   { type: Schema.Types.ObjectId, default: null },
      }],
      default: [],
    },
    org_id:     { type: Schema.Types.ObjectId, default: null, ref: "Organization" },
    created_by: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);



export const App = model<IApp>("App", AppSchema);
