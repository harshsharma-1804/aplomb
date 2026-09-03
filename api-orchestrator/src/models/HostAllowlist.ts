import { Schema, model, type Document, type Types } from "mongoose";

export interface IHostAllowlist extends Document {
  org_id: Types.ObjectId;
  /** Hostname or wildcard pattern e.g. "jsonplaceholder.typicode.com" or "*.typicode.com" */
  hostname: string;
  description: string;
  /** True when hostname starts with "*." — matches hostname and all subdomains */
  is_wildcard: boolean;
  created_by: Types.ObjectId | null;
  created_at: Date;
}

const HostAllowlistSchema = new Schema<IHostAllowlist>(
  {
    org_id:      { type: Schema.Types.ObjectId, required: true, ref: "Organization" },
    hostname:    { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    is_wildcard: { type: Boolean, default: false },
    created_by:  { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

HostAllowlistSchema.index({ org_id: 1, hostname: 1 }, { unique: true });

export const HostAllowlist = model<IHostAllowlist>("HostAllowlist", HostAllowlistSchema);
