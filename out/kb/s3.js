"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createS3Client = createS3Client;
const client_s3_1 = require("@aws-sdk/client-s3");
function createS3Client(cfg, creds) {
    // Yandex Object Storage is S3-compatible. We use path-style to be robust
    // across buckets with dots in the name and custom endpoints.
    return new client_s3_1.S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        forcePathStyle: true,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey
        }
    });
}
//# sourceMappingURL=s3.js.map