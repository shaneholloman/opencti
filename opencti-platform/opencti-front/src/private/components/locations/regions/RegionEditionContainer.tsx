import React, { FunctionComponent } from 'react';
import { graphql, PreloadedQuery, usePreloadedQuery } from 'react-relay';
import Drawer, { DrawerControlledDialType } from '@components/common/drawer/Drawer';
import { useFormatter } from '../../../../components/i18n';
import RegionEditionOverview from './RegionEditionOverview';
import Loader, { LoaderVariant } from '../../../../components/Loader';
import { RegionEditionContainerQuery } from './__generated__/RegionEditionContainerQuery.graphql';
import { useIsEnforceReference } from '../../../../utils/hooks/useEntitySettings';

interface RegionEditionContainerProps {
  handleClose: () => void
  queryRef: PreloadedQuery<RegionEditionContainerQuery>
  open?: boolean
  controlledDial?: DrawerControlledDialType
}

export const regionEditionQuery = graphql`
  query RegionEditionContainerQuery($id: String!) {
    region(id: $id) {
      ...RegionEditionOverview_region
      editContext {
        name
        focusOn
      }
    }
  }
`;

const RegionEditionContainer: FunctionComponent<RegionEditionContainerProps> = ({
  handleClose,
  queryRef,
  open,
  controlledDial,
}) => {
  const { t_i18n } = useFormatter();
  const { region } = usePreloadedQuery(regionEditionQuery, queryRef);
  if (region) {
    return (
      <Drawer
        title={t_i18n('Update a region')}
        context={region.editContext}
        onClose={handleClose}
        open={open}
        controlledDial={controlledDial}
      >
        {({ onClose }) => (
          <RegionEditionOverview
            regionRef={region}
            enableReferences={useIsEnforceReference('Region')}
            context={region.editContext}
            handleClose={onClose}
          />
        )}
      </Drawer>
    );
  }

  return <Loader variant={LoaderVariant.inline} />;
};

export default RegionEditionContainer;
