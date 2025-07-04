import React, { FunctionComponent } from 'react';
import { graphql, PreloadedQuery, usePreloadedQuery } from 'react-relay';
import Drawer, { DrawerControlledDialType } from '@components/common/drawer/Drawer';
import { useFormatter } from '../../../../components/i18n';
import DataComponentEditionOverview from './DataComponentEditionOverview';
import { DataComponentEditionContainerQuery } from './__generated__/DataComponentEditionContainerQuery.graphql';
import Loader, { LoaderVariant } from '../../../../components/Loader';
import { useIsEnforceReference } from '../../../../utils/hooks/useEntitySettings';

export const dataComponentEditionQuery = graphql`
  query DataComponentEditionContainerQuery($id: String!) {
    dataComponent(id: $id) {
      ...DataComponentEditionOverview_dataComponent
      editContext {
        name
        focusOn
      }
    }
  }
`;

interface DataComponentEditionContainerProps {
  queryRef: PreloadedQuery<DataComponentEditionContainerQuery>
  handleClose: () => void
  open?: boolean
  controlledDial?: DrawerControlledDialType
}

const DataComponentEditionContainer: FunctionComponent<DataComponentEditionContainerProps> = ({
  queryRef,
  handleClose,
  open,
  controlledDial,
}) => {
  const { t_i18n } = useFormatter();
  const { dataComponent } = usePreloadedQuery(dataComponentEditionQuery, queryRef);

  if (dataComponent) {
    return (
      <Drawer
        title={t_i18n('Update a data component')}
        context={dataComponent.editContext}
        onClose={handleClose}
        open={open}
        controlledDial={controlledDial}
      >
        {({ onClose }) => (
          <DataComponentEditionOverview
            data={dataComponent}
            enableReferences={useIsEnforceReference('Data-Component')}
            context={dataComponent.editContext}
            handleClose={onClose}
          />
        )}
      </Drawer>
    );
  }

  return <Loader variant={LoaderVariant.inline} />;
};

export default DataComponentEditionContainer;
