import { getEntityFromCache } from '../database/cache';
import { ENTITY_TYPE_SETTINGS } from '../schema/internalObject';
import { authenticateUserFromRequest, userWithOrigin, batchCreator, batchCreators, batchRolesForUsers, batchUserEffectiveConfidenceLevel } from '../domain/user';
import { isNotEmptyField } from '../database/utils';
import { logApp } from '../config/conf';
import { batchLoader } from '../database/middleware';
import { batchInternalRels, batchMarkingDefinitions } from '../domain/stixCoreObject';
import { elBatchIds, elBatchIdsWithRelCount } from '../database/engine';
import { batchStixDomainObjects } from '../domain/stixDomainObject';
import { batchFileMarkingDefinitions, batchFileWorks } from '../domain/file';
import { batchGlobalStatusesByType, batchRequestAccessStatusesByType } from '../domain/status';
import { batchEntitySettingsByType } from '../modules/entitySetting/entitySetting-domain';
import { batchIsSubAttackPattern } from '../domain/attackPattern';
import { executionContext, isUserInPlatformOrganization, SYSTEM_USER } from '../utils/access';

export const computeLoaders = (executeContext, user) => {
  // Generic loaders
  return {
    relsBatchLoader: batchLoader(batchInternalRels, executeContext, user),
    creatorsBatchLoader: batchLoader(batchCreators, executeContext, user),
    creatorBatchLoader: batchLoader(batchCreator, executeContext, user),
    idsBatchLoader: batchLoader(elBatchIds, executeContext, user),
    idsBatchLoaderWithCount: batchLoader(elBatchIdsWithRelCount, executeContext, user),
    markingsBatchLoader: batchLoader(batchMarkingDefinitions, executeContext, user),
    // Specific loaders
    domainsBatchLoader: batchLoader(batchStixDomainObjects, executeContext, user), // Could be change to use idsBatchLoader?
    userRolesBatchLoader: batchLoader(batchRolesForUsers, executeContext, user),
    userEffectiveConfidenceBatchLoader: batchLoader(batchUserEffectiveConfidenceLevel, executeContext, user),
    fileMarkingsBatchLoader: batchLoader(batchFileMarkingDefinitions, executeContext, user),
    fileWorksBatchLoader: batchLoader(batchFileWorks, executeContext, user),
    globalStatusBatchLoader: batchLoader(batchGlobalStatusesByType, executeContext, user),
    requestAccessStatusBatchLoader: batchLoader(batchRequestAccessStatusesByType, executeContext, user),
    entitySettingsBatchLoader: batchLoader(batchEntitySettingsByType, executeContext, user),
    isSubAttachPatternBatchLoader: batchLoader(batchIsSubAttackPattern, executeContext, user),
  };
};

export const createAuthenticatedContext = async (req, res, contextName) => {
  const executeContext = executionContext(contextName);
  executeContext.req = req;
  executeContext.res = res;
  const settings = await getEntityFromCache(executeContext, SYSTEM_USER, ENTITY_TYPE_SETTINGS);
  executeContext.otp_mandatory = settings.otp_mandatory ?? false;
  executeContext.workId = req.headers['opencti-work-id']; // Api call comes from a worker processing
  executeContext.draft_context = req.headers['opencti-draft-id']; // Api call is to be made is specific draft context
  executeContext.eventId = req.headers['opencti-event-id']; // Api call is due to listening event
  executeContext.previousStandard = req.headers['previous-standard']; // Previous standard id
  executeContext.synchronizedUpsert = req.headers['synchronized-upsert'] === 'true'; // If full sync needs to be done
  // region handle user
  try {
    const user = await authenticateUserFromRequest(executeContext, req);
    if (user) {
      if (!Object.keys(req.headers).some((k) => k === 'opencti-draft-id')) {
        executeContext.draft_context = user.draft_context;
      }
      executeContext.user = userWithOrigin(req, user);
      executeContext.user_otp_validated = true;
      executeContext.user_with_session = isNotEmptyField(req.session?.user);
      if (executeContext.user_with_session) {
        executeContext.user_otp_validated = req.session?.user.otp_validated ?? false;
      }
      executeContext.user_inside_platform_organization = isUserInPlatformOrganization(user, settings);
    }
  } catch (error) {
    logApp.error('Fail to authenticate the user in graphql context hook', { cause: error });
  }
  // endregion
  // Return with batch loaders
  executeContext.changeDraftContext = (draftId) => { executeContext.draft_context = draftId; };
  executeContext.batch = computeLoaders(executeContext, executeContext.user);
  return executeContext;
};
