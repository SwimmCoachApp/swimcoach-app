// E-mail d'invitation dans un groupe : enveloppe Deno de _shared/invite-email.js (JWT vérifié par la plateforme).
// Envoi par le SMTP Gmail de l'application, en SSL sur le port 465 (les ports 25 et 587 sont fermés
// aux Edge Functions). SMTP_USER et SMTP_PASS sont des secrets de la fonction, jamais dans le dépôt.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';
import { handleInviteEmail } from '../_shared/invite-email.js';
import { resolveKeys } from '../_shared/keys.js';

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  resolveKeys((name: string) => Deno.env.get(name)).secretKey!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const user = Deno.env.get('SMTP_USER');
const transport = nodemailer.createTransport({
  host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user, pass: Deno.env.get('SMTP_PASS') },
});

async function sendMail(m: { to: string; replyTo?: string; subject: string; text: string; html: string }) {
  if (!user || !Deno.env.get('SMTP_PASS')) throw new Error('smtp_not_configured');
  await transport.sendMail({ from: { name: 'SwimCoach App', address: user }, ...m });
}

Deno.serve((request: Request) => handleInviteEmail(request, { adminClient, sendMail }));
