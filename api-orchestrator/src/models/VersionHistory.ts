import { Schema, model, type Document, type Types } from "mongoose";

export type ChangeType =
  | "created" | "cloned" | "activated" | "deprecated"
  | "endpoint_added" | "endpoint_modified" | "endpoint_deleted" | "rollback";

export interface IVersionHistory extends Document {
  app_id: Types.ObjectId;
  change_type: ChangeType;
  changed_by: { user_id: Types.ObjectId | null; username: string };
  description: string;
  snapshot: { app: Record<string, unknown>; endpoints: Record<string, unknown>[] };
  created_at: Date;
}

const VersionHistorySchema = new Schema<IVersionHistory>(
  {
    app_id: { type: Schema.Types.ObjectId, required: true, ref: "App" },
    change_type: {
      type: String,
      enum: ["created","cloned","activated","deprecated","endpoint_added","endpoint_modified","endpoint_deleted","rollback"],
      required: true,
    },
    changed_by: {
      user_id:  { type: Schema.Types.ObjectId, default: null },
      username: { type: String, default: "system" },
    },
    description: { type: String, default: "" },
    snapshot: {
      app:       { type: Schema.Types.Mixed, required: true },
      endpoints: { type: [Schema.Types.Mixed], default: [] },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

VersionHistorySchema.index({ app_id: 1, created_at: -1 });

export const VersionHistory = model<IVersionHistory>("VersionHistory", VersionHistorySchema);
