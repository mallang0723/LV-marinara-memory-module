// The Marinara REST surface the memory screen calls (its connection list), answered from the host adapter.
export function registerHostRoutes(router, host) {
    router.add('GET', 'connections', ({ userId }) => host.connections(userId));
}
