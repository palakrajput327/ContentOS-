import { OAuth2Client } from 'google-auth-library';
import { ServiceUnavailableException } from '@nestjs/common';

export function googleAuthConfigured() {
  return !!(process.env.GOOGLE_AUTH_CLIENT_ID && process.env.GOOGLE_AUTH_CLIENT_SECRET && process.env.GOOGLE_AUTH_REDIRECT_URI);
}
export function googleAuthClient() {
  if(!googleAuthConfigured()) throw new ServiceUnavailableException('Google signup is not configured. Use email signup.');
  return new OAuth2Client({clientId:process.env.GOOGLE_AUTH_CLIENT_ID,clientSecret:process.env.GOOGLE_AUTH_CLIENT_SECRET,redirectUri:process.env.GOOGLE_AUTH_REDIRECT_URI});
}
