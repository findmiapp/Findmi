// Browser Supabase client stand-in. `uploads` records every Storage
// upload, so a guest test can prove nothing is ever sent to Storage.
export const uploads = [];
export const getBrowserSupabase = () => ({
  storage: { from: () => ({ uploadToSignedUrl: async (path) => (uploads.push(path), { error: null }) }) },
});
