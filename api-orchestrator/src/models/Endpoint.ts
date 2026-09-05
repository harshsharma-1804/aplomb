import { Schema, model, type Document, type Types } from "mongoose";

export interface ISchemaField {
  id: string;
  field_path: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  nullable: boolean;
  description: string;
  sort_order: number;
  item_schema?: ISchemaField[];
}

export interface IFieldMapping {
  schema_field_id: string;
  upstream_path?: string;
  static_value?: string;
  mapping_type: "direct" | "static" | "array";
  item_mappings?: IFieldMapping[];
}

export interface IBodyMapping {
  upstream_path: string;
  mapping_type: "direct" | "static" | "principal" | "array";
  source?: "input" | "query" | "path";
  input_path?: string;
  query_param?: string;
  path_param?: string;
  claim?: string;
  static_value?: string;
  item_mappings?: IBodyMapping[];
}

export interface IQueryParam {
  frontend_param: string;
  upstream_param: string;
  pass_through: boolean;
  default_value?: string;
}

export interface IPathParam {
  name: string;
  type: string;
  required: boolean;
}

export interface IFormEncoding {
  nested: "bracket" | "dot" | "reject";
  array: "repeat" | "bracket" | "indexed" | "comma";
  boolean: "true_false" | "one_zero";
  null: "omit" | "empty";
}

export interface IStaticHeader {
  name: string;
  value: string;
}

export interface IForwardedHeader {
  from_name: string;
  to_name: string;
  required: boolean;
}

export interface IUpstream {
  url: string;
  method: string;
  forward_cookies: boolean;
  auth_type: "none" | "forward_cookie" | "apikey" | "bearer";
  auth_config: { header_name?: string; secret_ref?: Types.ObjectId | null };
  body_content_type: "application/json" | "application/x-www-form-urlencoded";
  body_passthrough: boolean;
  form_encoding: IFormEncoding;
  body_mappings: IBodyMapping[];
  /** Static headers always sent to the upstream with fixed values */
  static_headers: IStaticHeader[];
  /** Rules to forward / rename headers arriving from the frontend request */
  forwarded_headers: IForwardedHeader[];
  /** When true all safe incoming request headers are forwarded to upstream */
  forward_all_headers: boolean;
}

export interface IRequest {
  content_type: "application/json" | "application/x-www-form-urlencoded";
  max_body_bytes: number;
  validation: "strict" | "permissive";
  input_schema: ISchemaField[];
}

export type ScriptMode = "none" | "script_full" | "script_pre" | "script_post" | "script_pre_post";

export interface IEndpoint extends Document {
  app_id: Types.ObjectId;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  is_active: boolean;
  folder: string | null;
  path_params: IPathParam[];
  request: IRequest;
  upstream: IUpstream;
  query_params: IQueryParam[];
  sample_response: { json: Record<string, unknown>; captured_at: Date } | null;
  output_schema: ISchemaField[];
  field_mappings: IFieldMapping[];
  script_mode: ScriptMode;
  script_file_id: Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const SchemaFieldDef: Record<string, unknown> = {
  id:           { type: String, required: true },
  field_path:   { type: String, required: true },
  type:         { type: String, enum: ["string","number","boolean","object","array","null"], default: "string" },
  nullable:     { type: Boolean, default: false },
  description:  { type: String, default: "" },
  sort_order:   { type: Number, default: 0 },
};

const FieldMappingDef: Record<string, unknown> = {
  schema_field_id: { type: String, required: true },
  upstream_path:   { type: String },
  static_value:    { type: String },
  mapping_type:    { type: String, enum: ["direct","static","array"], default: "direct" },
};

const BodyMappingDef: Record<string, unknown> = {
  upstream_path: { type: String, required: true },
  mapping_type:  { type: String, enum: ["direct","static","principal","array"], default: "direct" },
  source:        { type: String, enum: ["input","query","path"] },
  input_path:    { type: String },
  query_param:   { type: String },
  path_param:    { type: String },
  claim:         { type: String },
  static_value:  { type: String },
};

const EndpointSchema = new Schema<IEndpoint>(
  {
    app_id:      { type: Schema.Types.ObjectId, required: true, ref: "App" },
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    method:      { type: String, enum: ["GET","POST","PUT","DELETE","PATCH"], required: true },
    path:        { type: String, required: true, trim: true },
    is_active:   { type: Boolean, default: true },
    folder:      { type: String, default: null },

    path_params: { type: Schema.Types.Mixed, default: [] },

    request: {
      content_type:  { type: String, enum: ["application/json","application/x-www-form-urlencoded"], default: "application/json" },
      max_body_bytes: { type: Number, default: 262144 },
      validation:    { type: String, enum: ["strict","permissive"], default: "strict" },
      input_schema:  { type: Schema.Types.Mixed, default: [] },
    },

    upstream: {
      url:              { type: String, default: "" },
      method:           { type: String, default: "GET" },
      forward_cookies:  { type: Boolean, default: true },
      auth_type:        { type: String, enum: ["none","forward_cookie","apikey","bearer"], default: "forward_cookie" },
      auth_config: {
        header_name: { type: String },
        secret_ref:  { type: Schema.Types.ObjectId, default: null },
      },
      body_content_type: { type: String, enum: ["application/json","application/x-www-form-urlencoded"], default: "application/json" },
      body_passthrough:  { type: Boolean, default: false },
      form_encoding: {
        nested:  { type: String, enum: ["bracket","dot","reject"], default: "bracket" },
        array:   { type: String, enum: ["repeat","bracket","indexed","comma"], default: "repeat" },
        boolean: { type: String, enum: ["true_false","one_zero"], default: "true_false" },
        null:    { type: String, enum: ["omit","empty"], default: "omit" },
      },
      body_mappings: { type: Schema.Types.Mixed, default: [] },
      static_headers: {
        type: [{ name: String, value: String }],
        default: [],
      },
      forwarded_headers: {
        type: [{ from_name: String, to_name: String, required: Boolean }],
        default: [],
      },
      /** When true all safe incoming request headers are forwarded to upstream.
       *  Individual forwarded_headers rules still apply on top and can override. */
      forward_all_headers: { type: Boolean, default: false },
    },

    query_params: { type: [{ frontend_param: String, upstream_param: String, pass_through: Boolean, default_value: String }], default: [] },

    sample_response: {
      json:         { type: Schema.Types.Mixed },
      captured_at:  { type: Date },
    },

    output_schema:  { type: Schema.Types.Mixed, default: [] },
    field_mappings: { type: Schema.Types.Mixed, default: [] },

    script_mode:    { type: String, enum: ["none","script_full","script_pre","script_post","script_pre_post"], default: "none" },
    script_file_id: { type: Schema.Types.ObjectId, ref: "AppScript", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

EndpointSchema.index({ app_id: 1, method: 1, path: 1 }, { unique: true });

export const Endpoint = model<IEndpoint>("Endpoint", EndpointSchema);
