import { z } from 'zod';
export const remoteSystemSchema=z.enum(['ubuntu','debian','fedora','centos','rhel','rocky','almalinux','alpine','arch','suse','linux','windows','macos','freebsd','openbsd','netbsd','aix','solaris']);
export type RemoteSystem=z.infer<typeof remoteSystemSchema>;
