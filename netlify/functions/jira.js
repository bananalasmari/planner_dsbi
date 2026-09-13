'use strict';

const { handleJiraEvent, routeNameFromPath } = require('../../api/jira');

exports.handler = async (event) => {
  try {
    const result = await handleJiraEvent({
      method: event.httpMethod,
      route: routeNameFromPath(
        event.path,
        event.rawQuery || (event.queryStringParameters && new URLSearchParams(event.queryStringParameters).toString())
      )
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
        error: (err && err.code) || 'jira_error',
        message: (err && err.message) || 'تعذر إكمال طلب Jira.'
      })
    };
  }
};
