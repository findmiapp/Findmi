// next/navigation stand-in with a settable pathname.
export const state = { pathname: "/" };
export const usePathname = () => state.pathname;
export const useRouter = () => ({ back() {}, push() {}, refresh() {} });
