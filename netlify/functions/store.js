'use strict';

const { handleStoreEvent, routeNameFromPath } = require('../../api/store');

exports.handler = async (event) => {
  try {
    let body = {};
    if (event.body) {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
      body = raw ? JSON.parse(raw) : {};
    }
    const result = await handleStoreEvent({
      method: event.httpMethod,
      route: routeNameFromPath(
        event.path,
        event.rawQuery || (event.queryStringParameters && new URLSearchParams(event.queryStringParameters).toString())
      ),
      body,
      headers: event.headers || {}
    });
    return {
      statusCode: result.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(result.body || {})
    };
  } catch (err) {
    const status = Number(err && err.status) || 500;
    return {
      statusCode: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: (err && err.code) || 'store_error',
        message: (err && err.message) || 'تعذر إكمال طلب التخزين.'
      })
    };
  }
};
