(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KhuttaClickUpTypes = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NODE_KIND = {
    PLAN: 'plan',
    SPRINT: 'sprint',
    SCOPE: 'scope',
    PHASE: 'phase',
    MILESTONE: 'milestone'
  };

  /**
   * @typedef {Object} ClickUpDateRange
   * @property {string} [startDate] YYYY-MM-DD
   * @property {string} [dueDate] YYYY-MM-DD
   */

  /**
   * @typedef {Object} KhuttaClickUpTask
   * @property {string} key
   * @property {string} name
   * @property {string} [startDate]
   * @property {string} [dueDate]
   * @property {number} [features]
   * @property {string} [kind]
   */

  /**
   * @typedef {Object} KhuttaClickUpPlan
   * @property {string} [planId]
   * @property {string} planName
   * @property {string} [productName]
   * @property {string} [projectName]
   * @property {string} [scopeName]
   * @property {string} [ticketId]
   * @property {string} [startDate]
   * @property {string} [dueDate]
   * @property {number|null} [workingDays]
   * @property {number|null} [featureCount]
   * @property {boolean} [includeFeatures]
   * @property {string[]} [teamMembers]
   * @property {string} [teamTag]
   * @property {string} [notes]
   * @property {string} [sprintLabel]
   * @property {string} [dependencies]
   * @property {Array<{id?:string,name:string,startDate?:string,dueDate?:string}>} [milestones]
   * @property {Array<{id?:string,name:string,startDate?:string,dueDate?:string}>} [phases]
   * @property {KhuttaClickUpTask[]} [tasks]
   */

  /**
   * @typedef {Object} ClickUpTreeNode
   * @property {string} key
   * @property {string} name
   * @property {string} [description]
   * @property {string} [startDate]
   * @property {string} [dueDate]
   * @property {string} kind
   * @property {ClickUpTreeNode[]} [children]
   */

  /**
   * @typedef {Object} ClickUpChildBinding
   * @property {string} key
   * @property {string} taskId
   * @property {string} [name]
   */

  /**
   * @typedef {Object} ClickUpBinding
   * @property {string} taskId
   * @property {string} [url]
   * @property {string} [parentTaskId]
   * @property {string} [parentTaskName]
   * @property {string} [listId]
   * @property {string} [lastSyncedAt]
   * @property {ClickUpChildBinding[]} [children]
   */

  /**
   * @typedef {Object} ClickUpParentProject
   * @property {string} id
   * @property {string} name
   * @property {string} [listId]
   * @property {string} [url]
   */

  return {
    NODE_KIND,
    API_BASE: 'https://api.clickup.com/api/v2'
  };
});
