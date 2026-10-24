// Browser Supabase client stand-in. `uploads` records every Storage
// upload, so a guest test can prove nothing is ever sent to Storage.
export const uploads = [];
// Paths whose next upload attempt fails (a one-shot transient failure).
export const failOnce = new Set();
export const getBrowserSupabase = () => ({
  storage: {
    from: () => ({
      uploadToSignedUrl: async (path) => {
        uploads.push(path);
        if (failOnce.delete(path)) return { error: { message: "network error" } };
        return { error: null };
      },
    }),
  },
});
