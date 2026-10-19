export const pushes = [];
export const useRouter = () => ({ push: (url) => pushes.push(url), refresh() {}, replace() {} });
