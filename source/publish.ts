import { doPublish } from './do-publish';

export async function publish(data: any, opts: any) {
    // remove undocumented stuff.
    data({ undocumented: true }).remove();

    // get the doc list
    const docs = data().get();

    doPublish(docs, opts);
}