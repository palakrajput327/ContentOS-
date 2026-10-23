export function queueBackend() {
    const value = process.env.QUEUE_BACKEND || 'postgres';
    if (value !== 'bullmq' && value !== 'postgres')
        throw new Error('Invalid QUEUE_BACKEND');
    return value;
}
