// AWS Signature Version 4 for JSON POST APIs (Cost Explorer), WebCrypto only.
// https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html

import { hmac, sha256Hex, toHex } from "./util";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export async function signedJsonPost(opts: {
  creds: AwsCredentials;
  region: string;
  service: string;
  host: string;
  target: string;
  body: string;
  now: Date;
}): Promise<{ url: string; init: RequestInit }> {
  const { creds, region, service, host, target, body, now } = opts;
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": target,
  };
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, await sha256Hex(body)].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  let key = await hmac(`AWS4${creds.secretAccessKey}`, date);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, "aws4_request");
  const signature = toHex(await hmac(key, stringToSign));
  const { host: _host, ...sent } = headers;
  return {
    url: `https://${host}/`,
    init: {
      method: "POST",
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
    },
  };
}
