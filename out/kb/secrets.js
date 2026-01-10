"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getS3Credentials = getS3Credentials;
exports.setS3Credentials = setS3Credentials;
exports.clearS3Credentials = clearS3Credentials;
const ACCESS_KEY_KEY = 'luna.kb.s3.accessKeyId';
const SECRET_KEY_KEY = 'luna.kb.s3.secretAccessKey';
async function getS3Credentials(context) {
    const accessKeyId = await context.secrets.get(ACCESS_KEY_KEY);
    const secretAccessKey = await context.secrets.get(SECRET_KEY_KEY);
    if (!accessKeyId || !secretAccessKey)
        return null;
    return { accessKeyId, secretAccessKey };
}
async function setS3Credentials(context, creds) {
    await context.secrets.store(ACCESS_KEY_KEY, creds.accessKeyId);
    await context.secrets.store(SECRET_KEY_KEY, creds.secretAccessKey);
}
async function clearS3Credentials(context) {
    await context.secrets.delete(ACCESS_KEY_KEY);
    await context.secrets.delete(SECRET_KEY_KEY);
}
//# sourceMappingURL=secrets.js.map