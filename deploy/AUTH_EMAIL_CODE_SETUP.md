# NCore password-recovery code email setup

NCore's `/forgot-password` screen verifies eight-digit recovery codes with
`supabase.auth.verifyOtp({ email, token, type: 'recovery' })`.

To send that code instead of an easily consumed magic link, change the
**Password Recovery** email template in the Supabase Dashboard:

1. Open **Authentication → Email Templates → Reset Password**.
2. Set the subject to `Your NCore password reset code`.
3. Replace the template body with the following HTML and save it.

```html
<h2>Reset your NCore password</h2>
<p>Enter this 8-digit code in NCore to reset your password:</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">{{ .Token }}</p>
<p>This code expires shortly. If you did not request it, you can ignore this email.</p>
```

Do not include `{{ .ConfirmationURL }}` in this template. Email security
scanners can open a confirmation URL before the user does, which consumes a
single-use recovery token. The numeric `{{ .Token }}` is entered manually in
NCore and is verified as a `recovery` OTP.

For production, configure custom SMTP. Supabase's built-in sender is intended
for testing and is limited to two auth emails per hour project-wide.
