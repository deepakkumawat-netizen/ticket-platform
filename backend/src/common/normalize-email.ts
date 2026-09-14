// Every place an email is stored or looked up (staff signup/creation,
// customer creation, login) must agree on the same casing, or `User.email`/
// `Customer.email`'s case-sensitive unique constraint lets "Ramesh@x.com"
// and "ramesh@x.com" become two different accounts — and whichever case
// someone typed at signup silently locks them out if they type it
// differently at login. Trim first so incidental whitespace (a pasted
// email, autofill) doesn't create the same kind of duplicate.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
