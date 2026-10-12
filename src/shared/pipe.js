// Implementation
// This implementation uses a rest parameter to accept any number of functions
export function pipe(initial, ...functions) {
    let result = initial;
    for (const func of functions) {
        result = func(result);
    }
    return result;
}
