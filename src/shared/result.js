export const ok = (value) => {
    return {
        type: 'ok',
        value: value,
    };
};
export const err = (error) => {
    return {
        type: 'err',
        error: error,
    };
};
// apply a function to the value only if the result is successful
export const mapResult = (result, transform) => {
    if (result.type === 'ok') {
        const newValue = transform(result.value);
        return ok(newValue);
    }
    // if the result failed return the same error
    return result;
};
// apply a function that returns another Result
export const andThen = (result, nextOperation) => {
    if (result.type === 'ok') {
        return nextOperation(result.value);
    }
    // stop if the previous operation failed
    return result;
};
export const match = (result, handlers) => {
    if (result.type === 'ok') {
        return handlers.ok(result.value);
    }
    return handlers.err(result.error);
};
